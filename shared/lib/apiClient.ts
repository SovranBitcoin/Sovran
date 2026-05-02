import { GetInfoResponse } from '@cashu/cashu-ts';
import { ok, err, Result } from 'neverthrow';
import { z } from 'zod';
import { apiLog } from './logger';
import {
  AuditMintResponse as AuditMintResponseStrict,
  CatalogResponse,
  LatestVersionResponse,
  MintReviewsResponse,
  MintSearchResponse,
  NostrProfileResponse,
  SearchUsersResponse,
  loggableIssues,
  parseWith,
  type CatalogResponse as CatalogResponseType,
  type LatestVersionResponse as LatestVersionResponseType,
  type MintRecommendation,
  type MintReviewsResponse as MintReviewsResponseType,
  type MintSearchResponse as MintSearchResponseType,
  type MintSearchResult,
  type NostrProfileResponse as NostrProfileResponseType,
  type UserProfile,
  type ParseError,
  type SearchUsersResponse as SearchUsersResponseType,
  type TopFollower,
} from '@sovranbitcoin/schemas';

// Local relaxation: the auditor returns `info` in several shapes depending
// on the upstream mint state — sometimes a NUT-06 object, sometimes null,
// sometimes an empty string when it couldn't reach the mint. The strict
// schema rejected anything but a populated object, dropping `auditScore`/
// `auditState` whenever the auditor's mint reach failed. Match the lenient
// shape used by `MintSearchResult.info` (unknown + optional) — downstream
// consumers (getMintCatalog) already type-narrow before reading.
// TODO: mirror this in `sovran-schemas` and drop the override on next publish.
const AuditMintResponse = AuditMintResponseStrict.extend({
  info: z.unknown().optional(),
});
type AuditMintResponseType = z.infer<typeof AuditMintResponse>;

const BASE_URL = 'https://api.sovran.money/api';

export const PRICELIST_URL = `wss://ws.sovran.money`;

/**
 * Default per-request budget. React Native's `fetch` has no native timeout;
 * a request that never settles wedges the screen's loading state until the
 * OS reaps the socket — minutes on cellular. Every helper enforces this
 * unless the caller passes a tighter signal.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

// Re-export schema-derived types for callers that previously imported them
// from this module. `NostrProfileResponse` and `UserProfile` are re-exported
// under their canonical schema names so downstream consumers need no changes.
export type {
  AuditMintResponseType as AuditMintResponse,
  CatalogResponseType as WallpaperCatalogResponse,
  LatestVersionResponseType as LatestVersionResponse,
  MintRecommendation,
  MintReviewsResponseType as MintReviewsResponse,
  MintSearchResult,
  MintSearchResponseType as MintSearchResponse,
  NostrProfileResponseType as NostrProfileResponse,
  UserProfile,
  SearchUsersResponseType as SearchUsersResponse,
  TopFollower,
};

type FetchOrParseError = Error | ParseError;

function toError(e: FetchOrParseError): Error {
  if (e instanceof Error) return e;
  if ((e as ParseError).type === 'schema/zod') {
    const issues = (e as ParseError).issues.length;
    return new Error(`${(e as ParseError).where}: ${issues} schema issue(s)`);
  }
  return new Error('unknown error');
}

/**
 * `true` when the rejection came from an `AbortController.abort()` — caller
 * cancellation or the per-request timeout. Spec impls raise `DOMException`
 * here, but Hermes doesn't ship `DOMException`, so duck-type on `.name`
 * instead of using `instanceof`.
 */
function isAbortError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const name = (e as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * Combine an arbitrary number of signals into one. The result aborts when
 * any input aborts. Hand-rolled because `AbortSignal.any` is only widely
 * available on Hermes from RN 0.81+; the listener pattern works everywhere
 * `AbortController` does, which is Sovran's whole runtime range.
 */
function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  const onAbort = (reason: unknown) => controller.abort(reason);
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      controller.abort(s.reason);
      return controller.signal;
    }
    s.addEventListener('abort', () => onAbort(s.reason), { once: true });
  }
  return controller.signal;
}

/**
 * Build a signal that fires after `ms` ms. Falls back to a manual timer when
 * `AbortSignal.timeout` isn't on the runtime — kept to one call site so the
 * compatibility check is centralized. The fallback uses a plain `Error`
 * tagged with `name = 'TimeoutError'` because Hermes lacks `DOMException`;
 * `isAbortError` duck-types on the name either way.
 */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const c = new AbortController();
  setTimeout(() => {
    const err = new Error('Timed out');
    err.name = 'TimeoutError';
    c.abort(err);
  }, ms);
  return c.signal;
}

/**
 * Caller-supplied request controls. Every helper accepts these so a screen
 * can cancel an in-flight request when the user navigates away or types
 * another keystroke. The default `timeoutMs` is `DEFAULT_TIMEOUT_MS`.
 */
export interface RequestControls {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Core fetch-parse helper. Network or HTTP errors surface as `Error`;
 * shape validation failures are logged with paths+codes (never raw input)
 * and collapsed into `Error` to preserve the existing caller signature.
 *
 * `controls.signal` is the caller's abort source (e.g. effect cleanup);
 * `controls.timeoutMs` defaults to `DEFAULT_TIMEOUT_MS`. The two are
 * combined so whichever fires first wins.
 */
async function fetchParsed<T>(
  url: string,
  parser: (input: unknown) => Result<T, ParseError>,
  where: string,
  init?: RequestInit,
  controls: RequestControls = {}
): Promise<Result<T, Error>> {
  const { signal: callerSignal, timeoutMs = DEFAULT_TIMEOUT_MS } = controls;
  const signal = combineSignals(callerSignal, timeoutSignal(timeoutMs));

  try {
    apiLog.debug('api.fetch', { url });
    const res = await fetch(url, { ...init, signal });
    if (!res.ok) {
      apiLog.warn('api.fetch_error', { url, status: res.status });
      return err(new Error(`Fetch error: ${res.status} ${res.statusText}`));
    }
    const raw = await res.json();
    const parsed = parser(raw);
    if (parsed.isErr()) {
      apiLog.warn('api.parse_failed', { where, issues: loggableIssues(parsed.error) });
      return err(toError(parsed.error));
    }
    return ok(parsed.value);
  } catch (e) {
    if (isAbortError(e)) {
      apiLog.debug('api.fetch_aborted', {
        url,
        reason: callerSignal?.aborted ? 'caller' : 'timeout',
      });
      return err(e instanceof Error ? e : new Error('Aborted'));
    }
    apiLog.error('api.fetch_failed', { url, error: e });
    return err(e instanceof Error ? e : new Error('Unknown error'));
  }
}

// ---------------------------------------------------------------------------
// Parsers — hoisted to module scope to avoid Zod v4 JIT cost on each call.
// ---------------------------------------------------------------------------

const parseSearchUsers = parseWith(SearchUsersResponse, 'nostr/search');
const parseAuditMint = parseWith(AuditMintResponse, 'cashu/mint/audit');
const parseMintReviews = parseWith(MintReviewsResponse, 'cashu/mint/reviews');
const parseMintSearch = parseWith(MintSearchResponse, 'cashu/mints/search');
const parseNostrProfile = parseWith(NostrProfileResponse, 'nostr/profile');
const parseLatestVersion = parseWith(LatestVersionResponse, 'app/latest-version');
const parseCatalog = parseWith(CatalogResponse, 'wallpapers/catalog');

/**
 * Defensive guard for arbitrary `/v1/info` responses. The full contract
 * (every NUT block) belongs to `@cashu/cashu-ts`; we re-validate only the
 * NUT-06 spine here so a hostile or misconfigured mint returning
 * `{ name: [1,2,3] }` cannot reach `coco`'s blinding helpers. Unknown
 * fields pass through (Postel's Law) so cashu-ts type evolutions don't
 * require a Sovran release.
 */
const MintInfoSpine = z
  .object({
    name: z.string(),
    pubkey: z.string(),
    version: z.string(),
    nuts: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Public API client functions
// ---------------------------------------------------------------------------

export const searchUsers = ({
  query,
  limit = 10,
  signal,
}: {
  query: string;
  limit?: number;
  signal?: AbortSignal;
}) => {
  const params = new URLSearchParams({ query, limit: String(limit) });
  return fetchParsed(
    `${BASE_URL}/nostr/search?${params}`,
    parseSearchUsers,
    'nostr/search',
    undefined,
    { signal }
  );
};

export const auditMint = ({ mintUrl, signal }: { mintUrl: string; signal?: AbortSignal }) =>
  fetchParsed(
    `${BASE_URL}/cashu/mint/audit?mintUrl=${encodeURIComponent(mintUrl)}`,
    parseAuditMint,
    'cashu/mint/audit',
    undefined,
    { signal }
  );

export const reviewMint = ({ mintUrl, signal }: { mintUrl: string; signal?: AbortSignal }) =>
  fetchParsed(
    `${BASE_URL}/cashu/mint/reviews?mintUrl=${encodeURIComponent(mintUrl)}`,
    parseMintReviews,
    'cashu/mint/reviews',
    undefined,
    { signal }
  );

export const searchMints = ({
  query,
  currency,
  limit,
  fields,
  signal,
}: {
  query?: string;
  currency?: string;
  limit?: number;
  /** Comma-separated dot paths for /v1/info projection, e.g. "nuts.4,contact" or "*" */
  fields?: string;
  signal?: AbortSignal;
}) =>
  fetchParsed(
    `${BASE_URL}/cashu/mints/search?${new URLSearchParams({
      ...(query && { q: query }),
      ...(currency && currency !== 'ALL' && { currency }),
      ...(limit && { limit: String(limit) }),
      ...(fields && { fields }),
    })}`,
    parseMintSearch,
    'cashu/mints/search',
    undefined,
    { signal }
  );

export const getLatestVersion = ({
  storage,
  signal,
}: {
  storage: { version: string };
  signal?: AbortSignal;
}) =>
  fetchParsed(
    `${BASE_URL}/app/latest-version`,
    parseLatestVersion,
    'app/latest-version',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storage }),
    },
    { signal }
  );

export const fetchNostrProfile = (pubkey: string, controls: RequestControls = {}) =>
  fetchParsed(
    `${BASE_URL}/nostr/profile?pubkey=${encodeURIComponent(pubkey)}`,
    parseNostrProfile,
    'nostr/profile',
    undefined,
    controls
  );

/**
 * Fetches the wallpaper catalog and validates it against the shared Zod schema.
 * Unknown top-level fields are silently dropped (Postel's Law); a malformed
 * envelope is coerced into an `Error` with the parse-issue count for the
 * UI layer and the detail is logged via `loggableIssues`.
 */
export const fetchWallpaperCatalog = (controls: RequestControls = {}) =>
  fetchParsed(
    `${BASE_URL}/wallpapers/catalog`,
    parseCatalog,
    'wallpapers/catalog',
    undefined,
    controls
  );

// ---------------------------------------------------------------------------
// Mint `/v1/info` — upstream Cashu shape, owned by `@cashu/cashu-ts`
//
// We rely on cashu-ts for the structural type, but apply `MintInfoSpine` at
// runtime so a hostile or misconfigured mint can't ship a non-string `name`
// past the boundary. Cancellation and timeout share the same plumbing as
// `fetchParsed`.
// ---------------------------------------------------------------------------

export const fetchMintInfo = async (
  mintUrl: string,
  controls: RequestControls = {}
): Promise<Result<GetInfoResponse, Error>> => {
  const { signal: callerSignal, timeoutMs = DEFAULT_TIMEOUT_MS } = controls;
  const normalizedUrl = mintUrl.endsWith('/') ? mintUrl : `${mintUrl}/`;
  const infoUrl = `${normalizedUrl}v1/info`;
  const signal = combineSignals(callerSignal, timeoutSignal(timeoutMs));

  try {
    apiLog.debug('api.mint_info', { mintUrl });
    const res = await fetch(infoUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      signal,
    });

    if (!res.ok) {
      apiLog.warn('api.mint_info_error', { mintUrl, status: res.status });
      return err(
        new Error(`Mint info fetch error: ${res.status} ${res.statusText} for ${infoUrl}`)
      );
    }

    const data = await res.json();
    const guard = MintInfoSpine.safeParse(data);
    if (!guard.success) {
      apiLog.warn('api.mint_info.invalid_shape', {
        mintUrl,
        issues: guard.error.issues.length,
      });
      return err(new Error(`Mint info from ${mintUrl} has malformed NUT-06 spine`));
    }
    apiLog.debug('api.mint_info.ok', { mintUrl, name: guard.data.name, hasIcon: !!data?.icon_url });
    return ok(data as GetInfoResponse);
  } catch (e) {
    if (isAbortError(e)) {
      apiLog.debug('api.mint_info.aborted', {
        mintUrl,
        reason: callerSignal?.aborted ? 'caller' : 'timeout',
      });
      return err(e instanceof Error ? e : new Error('Aborted'));
    }
    apiLog.error('api.mint_info_failed', { mintUrl, error: e });
    return err(
      e instanceof Error ? e : new Error(`Unknown error fetching mint info from ${infoUrl}`)
    );
  }
};
