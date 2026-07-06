import { GetInfoResponse } from '@cashu/cashu-ts';
import {
  combineSignals,
  createNostrMintEnrichment,
  isAbortError,
  timeoutSignal,
  type MintReviewRecommendation,
  type MintReviewsSummary,
  type RequestControls,
} from 'wallet';
import { ok, err, Result, ResultAsync } from 'neverthrow';
import { nip19 } from 'nostr-tools';
import { z } from 'zod';
import { apiLog } from './logger';
import {
  AuditMintResponse as AuditMintResponseStrict,
  CatalogResponse,
  LatestVersionResponse,
  NostrProfileFull as NostrProfileFullStrict,
  TopFollower as TopFollowerStrict,
  loggableIssues,
  parseWith,
  type MintRecommendation as SchemaMintRecommendation,
  type MintSearchResult,
  type ParseError,
} from '@sovranbitcoin/schemas';
import { backendConfig } from '@/shared/config/backend';
import { NaggAiLineupSchema } from '@/shared/lib/routstr/lineup';

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

// Local compatibility while the shared package release catches up to the
// live `/nostr/profile` wire shape. Vertex can return `null` when pagerank,
// created_at, or node count are not computable; rejecting the whole profile
// would drop otherwise useful follower/name/picture data.
const NullableVertexMetric = z.number().nullable();
const TopFollower = TopFollowerStrict.extend({
  score: NullableVertexMetric.optional(),
});
const NostrProfileFull = NostrProfileFullStrict.extend({
  score: NullableVertexMetric,
  created_at: z.number().int().nullable(),
  nodes: z.number().int().nonnegative().nullable().optional(),
  topFollowers: z.array(TopFollower).max(500),
});
type NostrProfileFullType = z.infer<typeof NostrProfileFull>;
// `score` is nullable: nagg/colada now surface NIP-87 recommendations posted
// without a [n/5] marker (score-less endorsements) instead of dropping them, so
// the list stays 1:1 with the server's reviewCount.
export type MintRecommendation = Omit<SchemaMintRecommendation, 'score'> & {
  score: number | null;
} & Partial<Pick<MintReviewRecommendation, 'name' | 'displayName' | 'picture' | 'image'>>;
type MintReviewsResponseType = {
  mintUrl: string;
  score: number | null;
  recommendations: MintRecommendation[];
  lastUpdated: number | null;
  fromCache: boolean;
};
// nagg's rich discovery row — one call returns every mint card field (audit
// state, units, reviews + favourite split, operator Nostr identity + Vertex
// reputation), replacing the api.sovran.money search + per-mint review/profile
// N+1 fan-outs. Lenient (passthrough) so a nagg field addition needs no release.
const DiscoverMint = z
  .object({
    mintUrl: z.string().max(2048),
    name: z.string().max(256).optional(),
    iconUrl: z.string().max(2048).optional(),
    description: z.string().max(4096).optional(),
    supportedUnits: z.array(z.string().max(16)).max(64).optional(),
    // The mint's NUT-06 `nuts` capability map, VERBATIM (nagg passes it
    // through from the auditor's cached /v1/info; deliberately undistilled).
    // Derive capabilities client-side via shared/lib/cashu/mintNuts —
    // payment methods from nuts['4']/['5'], feature flags from
    // nuts['7']/['10']/['17'] etc. Absent when the auditor had no info for
    // the mint; the discovery method filter treats absence as "not known to
    // support".
    nuts: z.record(z.string(), z.unknown()).optional(),
    averageScore: z.number().nullable(),
    reviewCount: z.number().int().nonnegative(),
    favouriteCount: z.number().int().nonnegative().optional(),
    hasAudit: z.boolean().optional(),
    state: z.string().max(32).optional(),
    nMints: z.number().int().optional(),
    nMelts: z.number().int().optional(),
    nErrors: z.number().int().optional(),
    operatorPubkey: z.string().max(128).optional(),
    operatorNpub: z.string().max(128).optional(),
    followers: z.number().int().optional(),
    follows: z.number().int().optional(),
    vertexRank: z.number().optional(),
    vertexScore: z.number().nullable().optional(),
  })
  .passthrough();
export type DiscoverMint = z.infer<typeof DiscoverMint>;
const ReviewerProfileInfo = z
  .object({ name: z.string().optional(), picture: z.string().optional() })
  .passthrough();
const DiscoverMintsResponse = z.object({
  mints: z.array(DiscoverMint).max(10_000),
  profiles: z.record(z.string(), ReviewerProfileInfo).optional(),
});

const API_BASE_URL = backendConfig.apiBaseUrl;
const SCORE_API_BASE_URL = backendConfig.scoreApiBaseUrl;

/**
 * Default per-request budget. React Native's `fetch` has no native timeout;
 * a request that never settles wedges the screen's loading state until the
 * OS reaps the socket — minutes on cellular. Every helper enforces this
 * unless the caller passes a tighter signal. The wallet endpoints sit
 * behind sovran.money so use a tighter budget than colada's
 * `DEFAULT_TIMEOUT_MS` (15s, tuned for arbitrary LNURL endpoints).
 */
const DEFAULT_TIMEOUT_MS = 10_000;
const mintReviewsEnrichment = createNostrMintEnrichment({
  appViewBaseUrl: backendConfig.nostrAppViewBaseUrl,
  appViewVersion: 'v1',
  timeoutMs: DEFAULT_TIMEOUT_MS,
});
// Re-export schema-derived types for callers that previously imported them
// from this module.
export type {
  AuditMintResponseType as AuditMintResponse,
  MintSearchResult,
  NostrProfileFullType as NostrProfileFull,
};
export type { NostrSearchResult } from '@sovranbitcoin/schemas';

// Re-export colada's cancellable-fetch primitives so existing
// `@/shared/lib/apiClient` consumers don't have to learn the new import
// path. `colada/safeFetch` is the canonical implementation.
export { isAbortError };

type FetchOrParseError = Error | ParseError;

function toError(e: FetchOrParseError): Error {
  if (e instanceof Error) return e;
  if ((e as ParseError).type === 'schema/zod') {
    const issues = (e as ParseError).issues.length;
    return new Error(`${(e as ParseError).where}: ${issues} schema issue(s)`);
  }
  return new Error('unknown error');
}

function toUnknownError(e: unknown): Error {
  return e instanceof Error ? e : new Error(typeof e === 'string' ? e : 'Unknown error');
}

function normalizeMintReviewsSummary(
  mintUrl: string,
  summary: MintReviewsSummary | undefined
): MintReviewsResponseType {
  return {
    mintUrl: summary?.mintUrl ?? mintUrl,
    score: summary?.score ?? null,
    recommendations: (summary?.recommendations ?? []).map((review) => ({
      score: review.score,
      comment: review.comment,
      pubkey: review.pubkey,
      eventId: review.eventId,
      created_at: review.created_at,
      ...(review.name ? { name: review.name } : {}),
      ...(review.displayName ? { displayName: review.displayName } : {}),
      ...(review.picture ? { picture: review.picture } : {}),
      ...(review.image ? { image: review.image } : {}),
    })),
    lastUpdated: summary?.lastUpdated ?? null,
    fromCache: summary?.fromCache ?? true,
  };
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

export async function fetchStatus(
  url: string,
  init?: RequestInit,
  controls: RequestControls = {}
): Promise<Result<{ ok: boolean; status: number }, Error>> {
  const { signal: callerSignal, timeoutMs = DEFAULT_TIMEOUT_MS } = controls;
  const signal = combineSignals(callerSignal, timeoutSignal(timeoutMs));
  const route = describeRoute(url);

  try {
    apiLog.debug('api.fetch_status', route);
    const res = await fetch(url, { ...init, signal });
    if (!res.ok) {
      apiLog.warn('api.fetch_status_not_ok', { ...route, status: res.status });
    }
    return ok({ ok: res.ok, status: res.status });
  } catch (e) {
    if (isAbortError(e)) {
      apiLog.debug('api.fetch_status_aborted', {
        ...route,
        reason: callerSignal?.aborted ? 'caller' : 'timeout',
      });
      return err(e instanceof Error ? e : new Error('Aborted'));
    }
    apiLog.error('api.fetch_status_failed', { ...route, error: e });
    return err(e instanceof Error ? e : new Error('Unknown error'));
  }
}

/**
 * Logger-safe URL projection. Query strings can carry user-entered PII for
 * profile search and arbitrary mint URLs for `cashu/mint/*`; the ring buffer
 * can be exported via `dumpForLLM`, so we never let the raw query reach a log
 * line. Host + path is enough to disambiguate routes during triage.
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

const parseAuditMint = parseWith(AuditMintResponse, 'cashu/mint/audit');
// nagg v2 serves /nostr/profile as the generic providers envelope: kind-0
// events in events[], counts under pubkey-keyed aggregates, and float
// provider payloads (vertex rank/score, nagg firstEventAt, nip05 validity)
// under providers[pubkey]. Map it into the app-facing NostrProfileFull shape
// the callers have always consumed, then validate the RESULT with the shared
// schema so downstream guarantees are unchanged.
const ProfileEnvelope = z.object({
  events: z.array(
    z.object({
      id: z.string(),
      kind: z.number().int(),
      pubkey: z.string(),
      content: z.string(),
      created_at: z.number().int(),
    })
  ),
  aggregates: z
    .record(z.string(), z.record(z.string(), z.record(z.string(), z.number())))
    .default({}),
  providers: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  fromCache: z.boolean().optional(),
});

function npubOrEmpty(hex: string): string {
  try {
    return nip19.npubEncode(hex);
  } catch {
    return '';
  }
}

function metadataFields(content: string): Record<string, string> {
  try {
    const meta = JSON.parse(content) as Record<string, unknown>;
    const pick = (k: string) =>
      typeof meta[k] === 'string' && meta[k]
        ? { [k === 'display_name' ? 'displayName' : k]: meta[k] as string }
        : {};
    return {
      ...pick('name'),
      ...pick('display_name'),
      ...pick('picture'),
      ...pick('banner'),
      ...pick('about'),
      ...pick('nip05'),
      ...pick('website'),
      ...pick('lud16'),
      ...pick('lud06'),
    };
  } catch {
    return {};
  }
}

const parseNostrProfileFor =
  (pubkey: string) =>
  (input: unknown): Result<NostrProfileFullType, ParseError> => {
    const env = ProfileEnvelope.safeParse(input);
    if (!env.success) {
      return err({ type: 'schema/zod', where: 'nostr/profile', issues: env.error.issues });
    }
    const { events, aggregates, providers, fromCache } = env.data;

    // Latest kind-0 per author (envelope hydration is just more events).
    const k0ByPubkey = new Map<string, (typeof events)[number]>();
    for (const e of events) {
      if (e.kind !== 0) continue;
      const prev = k0ByPubkey.get(e.pubkey);
      if (!prev || e.created_at > prev.created_at) k0ByPubkey.set(e.pubkey, e);
    }

    const prov = (pk: string, ns: string): Record<string, unknown> =>
      (providers[pk]?.[ns] ?? {}) as Record<string, unknown>;
    const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

    const vertex = prov(pubkey, 'vertex');
    const followerRefs = Array.isArray(vertex.references)
      ? (vertex.references as unknown[]).filter((r): r is string => typeof r === 'string')
      : [];
    const topFollowers = followerRefs.map((pk) => {
      const fv = prov(pk, 'vertex');
      const fk0 = k0ByPubkey.get(pk);
      return {
        pubkey: pk,
        npub: npubOrEmpty(pk),
        rank: num(fv.rank) ?? 0,
        ...(num(fv.score) !== undefined ? { score: num(fv.score) } : { score: null }),
        ...(fk0 ? metadataFields(fk0.content) : {}),
      };
    });

    const agg = (rule: string, metric: string): number | undefined =>
      aggregates[pubkey]?.[rule]?.[metric];
    const nip05Valid = prov(pubkey, 'nip05').valid;
    const k0 = k0ByPubkey.get(pubkey);

    const candidate = {
      pubkey,
      npub: npubOrEmpty(pubkey),
      rank: num(vertex.rank) ?? 0,
      score: num(vertex.score) ?? null,
      followers: agg('k3_p_latest', 'actors') ?? 0,
      follows: agg('k3_author_latest', 'sources') ?? 0,
      created_at: num(prov(pubkey, 'nagg').firstEventAt) ?? null,
      nodes: num(vertex.nodes) ?? null,
      topFollowers,
      fromCache: fromCache ?? false,
      ...(typeof nip05Valid === 'boolean' ? { nip05Valid } : {}),
      ...(k0 ? metadataFields(k0.content) : {}),
    };
    const parsed = NostrProfileFull.safeParse(candidate);
    if (!parsed.success) {
      return err({ type: 'schema/zod', where: 'nostr/profile', issues: parsed.error.issues });
    }
    return ok(parsed.data);
  };
const parseLatestVersion = parseWith(LatestVersionResponse, 'app/latest-version');
const parseAiLineup = parseWith(NaggAiLineupSchema, 'app/ai-lineup');
const parseDiscoverMints = parseWith(DiscoverMintsResponse, 'nostr/mint/discover');
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

/**
 * nagg mint discovery: one app-view call returning every known mint with audit
 * state, supported units, review + favourite aggregates, and the operator's
 * Nostr identity + Vertex reputation. Served by nagg (SCORE_API_BASE_URL), so
 * the app no longer needs api.sovran.money's /cashu/mints/search + per-mint
 * review/profile fan-outs for discovery.
 */
export const discoverMints = ({ limit, signal }: { limit?: number; signal?: AbortSignal } = {}) =>
  fetchJson(
    `${SCORE_API_BASE_URL}/nostr/mint/discover${limit ? `?limit=${limit}` : ''}`,
    parseDiscoverMints,
    'nostr/mint/discover',
    undefined,
    { signal }
  );

export const auditMint = ({ mintUrl, signal }: { mintUrl: string; signal?: AbortSignal }) =>
  fetchJson(
    `${API_BASE_URL}/cashu/mint/audit?mintUrl=${encodeURIComponent(mintUrl)}`,
    parseAuditMint,
    'cashu/mint/audit',
    undefined,
    { signal }
  );

export const reviewMint = async ({
  mintUrl,
  signal,
}: {
  mintUrl: string;
  signal?: AbortSignal;
}): Promise<Result<MintReviewsResponseType, Error>> => {
  const result = await ResultAsync.fromThrowable<[], MintReviewsSummary | undefined, Error>(
    () => mintReviewsEnrichment.fetchMintReviews(mintUrl, { signal }),
    toUnknownError
  )();
  return result.map((summary) => normalizeMintReviewsSummary(mintUrl, summary));
};

export const getLatestVersion = ({
  storage,
  signal,
}: {
  storage: { version: string };
  signal?: AbortSignal;
}) =>
  fetchJson(
    // Served by nagg (SCORE_API_BASE_URL), not api.sovran.money.
    `${SCORE_API_BASE_URL}/app/latest-version`,
    parseLatestVersion,
    'app/latest-version',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storage }),
    },
    { signal }
  );

/**
 * nagg-served AI model lineup (see `shared/lib/routstr/lineup.ts` for the
 * schema and precedence rules). Served by nagg, not api.sovran.money, so a
 * nagg deploy can retune the AI tab on shipped builds.
 */
export const getAiLineup = (controls: RequestControls = {}) =>
  fetchJson(
    `${SCORE_API_BASE_URL}/app/ai-lineup`,
    parseAiLineup,
    'app/ai-lineup',
    undefined,
    controls
  );

/** Test seam: the v2 envelope -> NostrProfileFull mapper. */
export const __parseNostrProfileForTest = parseNostrProfileFor;

export const fetchNostrProfile = (pubkey: string, controls: RequestControls = {}) =>
  fetchJson(
    `${SCORE_API_BASE_URL}/nostr/profile?pubkey=${encodeURIComponent(pubkey)}`,
    parseNostrProfileFor(pubkey),
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
    `${API_BASE_URL}/wallpapers/catalog`,
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
