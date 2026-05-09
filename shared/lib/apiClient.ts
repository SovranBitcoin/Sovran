import { GetInfoResponse } from '@cashu/cashu-ts';
import { combineSignals, isAbortError, timeoutSignal, type RequestControls } from 'coco-payment-ux';
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
  type MintRecommendation,
  type MintSearchResult,
  type NostrProfileResponse as NostrProfileResponseType,
  type UserProfile,
  type ParseError,
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

/**
 * Default per-request budget. React Native's `fetch` has no native timeout;
 * a request that never settles wedges the screen's loading state until the
 * OS reaps the socket — minutes on cellular. Every helper enforces this
 * unless the caller passes a tighter signal. The wallet endpoints sit
 * behind sovran.money so use a tighter budget than coco-payment-ux's
 * `DEFAULT_TIMEOUT_MS` (15s, tuned for arbitrary LNURL endpoints).
 */
const DEFAULT_TIMEOUT_MS = 10_000;

// Re-export schema-derived types for callers that previously imported them
// from this module.
export type {
  AuditMintResponseType as AuditMintResponse,
  MintRecommendation,
  MintSearchResult,
  NostrProfileResponseType as NostrProfileResponse,
  UserProfile,
};

// Re-export coco-payment-ux's cancellable-fetch primitives so existing
// `@/shared/lib/apiClient` consumers don't have to learn the new import
// path. `coco-payment-ux/safeFetch` is the canonical implementation.
export { isAbortError, type RequestControls };

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
 * Compose a caller's abort signal with the per-request timeout into the
 * `signal` to hand to `fetch`. Throw-style callers (e.g. shared/lib/routstr,
 * which surfaces errors via thrown `RoutstrError`) reach for this so they
 * stop bypassing the timeout while keeping their existing exception flow.
 */
export function buildAbortSignal(controls: RequestControls = {}): AbortSignal {
  const { signal: callerSignal, timeoutMs = DEFAULT_TIMEOUT_MS } = controls;
  return combineSignals(callerSignal, timeoutSignal(timeoutMs));
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
export async function fetchJson<T>(
  url: string,
  parser: (input: unknown) => Result<T, ParseError>,
  where: string,
  init?: RequestInit,
  controls: RequestControls = {}
): Promise<Result<T, Error>> {
  const { signal: callerSignal, timeoutMs = DEFAULT_TIMEOUT_MS } = controls;
  const signal = combineSignals(callerSignal, timeoutSignal(timeoutMs));
  const route = describeRoute(url);

  try {
    apiLog.debug('api.fetch', route);
    const res = await fetch(url, { ...init, signal });
    if (!res.ok) {
      apiLog.warn('api.fetch_error', { ...route, status: res.status });
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
        ...route,
        reason: callerSignal?.aborted ? 'caller' : 'timeout',
      });
      return err(e instanceof Error ? e : new Error('Aborted'));
    }
    apiLog.error('api.fetch_failed', { ...route, error: e });
    return err(e instanceof Error ? e : new Error('Unknown error'));
  }
}

/**
 * Logger-safe URL projection. Query strings carry user-entered PII for
 * `nostr/search` (names, NIP-05 addresses) and arbitrary mint URLs for
 * `cashu/mint/*`; the ring buffer can be exported via `dumpForLLM`, so we
 * never let the raw query reach a log line. Host + path is enough to
 * disambiguate routes during triage.
 */
function describeRoute(url: string): { host: string; path: string } {
  try {
    const parsed = new URL(url);
    return { host: parsed.host, path: parsed.pathname };
  } catch {
    return { host: 'invalid', path: url };
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
 * require a Sovran release. The full `GetInfoResponse` shape is owned by
 * cashu-ts; we narrow the validated input through a cast so callers get the
 * cashu-ts type without us re-asserting every NUT block.
 */
const MintInfoSpine = z
  .object({
    name: z.string(),
    pubkey: z.string(),
    version: z.string(),
    nuts: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const parseMintInfo = (input: unknown): Result<GetInfoResponse, ParseError> => {
  const r = MintInfoSpine.safeParse(input);
  if (!r.success) {
    return err({ type: 'schema/zod', where: 'cashu/mint/info', issues: r.error.issues });
  }
  return ok(input as GetInfoResponse);
};

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
  return fetchJson(
    `${BASE_URL}/nostr/search?${params}`,
    parseSearchUsers,
    'nostr/search',
    undefined,
    { signal }
  );
};

export const auditMint = ({ mintUrl, signal }: { mintUrl: string; signal?: AbortSignal }) =>
  fetchJson(
    `${BASE_URL}/cashu/mint/audit?mintUrl=${encodeURIComponent(mintUrl)}`,
    parseAuditMint,
    'cashu/mint/audit',
    undefined,
    { signal }
  );

export const reviewMint = ({ mintUrl, signal }: { mintUrl: string; signal?: AbortSignal }) =>
  fetchJson(
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
  fetchJson(
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
  fetchJson(
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
  fetchJson(
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
  fetchJson(
    `${BASE_URL}/wallpapers/catalog`,
    parseCatalog,
    'wallpapers/catalog',
    undefined,
    controls
  );

// ---------------------------------------------------------------------------
// Mint `/v1/info` — upstream Cashu shape, owned by `@cashu/cashu-ts`.
//
// `MintInfoSpine` runs at the boundary so a hostile or misconfigured mint
// can't ship a non-string `name` past the validator; the full `GetInfoResponse`
// type is owned by cashu-ts. Cancellation, timeout, and HTTP error mapping
// share the canonical `fetchJson` scaffolding.
// ---------------------------------------------------------------------------

export const fetchMintInfo = (
  mintUrl: string,
  controls: RequestControls = {}
): Promise<Result<GetInfoResponse, Error>> => {
  // Defence-in-depth: this is the one helper that dials arbitrary
  // user-supplied hosts. Callers normalize the URL, but a stray `http://`
  // or `file://` would otherwise sail through to `fetch`. Reject anything
  // that isn't `https:` here so the policy is enforced at the boundary
  // regardless of which call site forgot to validate.
  let parsed: URL;
  try {
    parsed = new URL(mintUrl);
  } catch {
    return Promise.resolve(err(new Error('Invalid mint URL')));
  }
  if (parsed.protocol !== 'https:') {
    apiLog.warn('api.mint_info_scheme_rejected', {
      host: parsed.host,
      protocol: parsed.protocol,
    });
    return Promise.resolve(err(new Error(`Mint URL must use https: (got ${parsed.protocol})`)));
  }

  const normalizedUrl = mintUrl.endsWith('/') ? mintUrl : `${mintUrl}/`;
  return fetchJson(
    `${normalizedUrl}v1/info`,
    parseMintInfo,
    'cashu/mint/info',
    { headers: { Accept: 'application/json' } },
    controls
  );
};
