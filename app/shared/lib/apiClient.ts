import { facade } from 'nostr';
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
import * as nip19 from 'nostr-tools/nip19';
import { z } from 'zod';
import { apiLog } from './logger';
import {
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
import { DEFAULT_TIMEOUT_MS } from '@/shared/lib/http/requestSignal';
import { NaggAiLineupSchema } from '@/shared/lib/routstr/lineup';

// Local compatibility while the shared package release catches up to the
// live `/nostr/profile` wire shape. Vertex can return `null` when pagerank,
// created_at, or node count are not computable; rejecting the whole profile
// would drop otherwise useful follower/name/picture data.
const NullableVertexMetric = z.number().nullable();
const TopFollower = TopFollowerStrict.extend({
  score: NullableVertexMetric.optional(),
});
const NostrProfileFull = NostrProfileFullStrict.extend({
  vertexFetchedAt: z.number().nullish(),
  vertexFresh: z.boolean().nullish(),
  score: NullableVertexMetric,
  // Counts are absent, never 0, when nagg has no aggregate for the pubkey
  // (nostr module off, or a profile it has not indexed). `useNostrProfile`
  // completes them from Primal / the contact list; screens render a
  // placeholder for `undefined` instead of a misleading zero.
  followers: z.number().int().nonnegative().optional(),
  follows: z.number().int().nonnegative().optional(),
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
// reputation), replacing the separate search + per-mint review/profile
// N+1 fan-outs. Lenient (passthrough) so a nagg field addition needs no release.
const DiscoverMint = z.looseObject({
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
  uptime24h: z.number().optional(),
  avgLatencyMs: z.number().optional(),
  auditSource: z.enum(['ucash', '8333']).optional().catch(undefined),
  auditUpdatedAt: z.union([z.number(), z.string().max(128)]).optional(),
  operatorPubkey: z.string().max(128).optional(),
  operatorNpub: z.string().max(128).optional(),
  followers: z.number().int().optional(),
  follows: z.number().int().optional(),
  vertexRank: z.number().optional(),
  vertexScore: z.number().nullable().optional(),
});
export type DiscoverMint = z.infer<typeof DiscoverMint>;
// nagg's mint-info changelog: every tracked mint's NUT-06 revisions, newest
// first, each carrying the RFC-6902 patch that produced it. Lenient like
// `DiscoverMint` — the `patch` ops are a wire shape we only ever read, and the
// decoder (`features/mint/lib/mintChanges/decode`) tolerates unknown ops.
const MintChangePatchOp = z.looseObject({
  op: z.string().max(16),
  path: z.string().max(1024),
  value: z.unknown().optional(),
});
const MintChange = z.looseObject({
  mintUrl: z.string().max(2048),
  name: z.string().max(256).optional(),
  at: z.number().int().nonnegative(),
  previousLastSeenAt: z.number().int().nonnegative().optional(),
  hash: z.string().max(128),
  summary: z.array(z.string().max(512)).max(200).optional(),
  patch: z.array(MintChangePatchOp).max(500).optional(),
});
const MintChangesResponse = z.object({
  trackedMints: z.number().int().nonnegative(),
  reachableMints: z.number().int().nonnegative(),
  totalChanges: z.number().int().nonnegative(),
  changes: z.array(MintChange).max(1000),
});
export type MintChangesResponse = z.infer<typeof MintChangesResponse>;

const ReviewerProfileInfo = z.looseObject({
  name: z.string().optional(),
  picture: z.string().optional(),
});
const DiscoverMintsResponse = z.object({
  mints: z.array(DiscoverMint).max(10_000),
  profiles: z.record(z.string(), ReviewerProfileInfo).optional(),
});

const SCORE_API_BASE_URL = backendConfig.scoreApiBaseUrl;

/**
 * Default per-request budget. React Native's `fetch` has no native timeout;
 * a request that never settles wedges the screen's loading state until the
 * OS reaps the socket — minutes on cellular. Every helper enforces this
 * unless the caller passes a tighter signal. The wallet endpoints sit
 * behind sovran.money so use a tighter budget than colada's
 * `DEFAULT_TIMEOUT_MS` (15s, tuned for arbitrary LNURL endpoints).
 */
const mintReviewsEnrichment = createNostrMintEnrichment({
  appViewBaseUrl: backendConfig.nostrAppViewBaseUrl,
  appViewVersion: 'v1',
  timeoutMs: DEFAULT_TIMEOUT_MS,
});
// Re-export schema-derived types for callers that previously imported them
// from this module.
export type { MintSearchResult, NostrProfileFullType as NostrProfileFull };
export type { NostrSearchResult } from '@sovranbitcoin/schemas';

type FetchOrParseError = Error | ParseError;

export class ApiHttpError extends Error {
  constructor(
    readonly status: number,
    statusText: string
  ) {
    super(`Fetch error: ${status} ${statusText}`);
  }
}

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
      return err(new ApiHttpError(res.status, res.statusText));
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

export const parseNostrProfileFor =
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
    const followers = agg('k3_p_latest', 'actors');
    const follows = agg('k3_author_latest', 'sources');
    const nip05Valid = prov(pubkey, 'nip05').valid;
    const k0 = k0ByPubkey.get(pubkey);

    const candidate = {
      pubkey,
      npub: npubOrEmpty(pubkey),
      rank: num(vertex.rank) ?? 0,
      score: num(vertex.score) ?? null,
      vertexFetchedAt: num(vertex.vertexFetchedAt) ?? num(vertex.fetchedAt) ?? null,
      vertexFresh: typeof vertex.vertexFresh === 'boolean' ? vertex.vertexFresh : null,
      ...(followers !== undefined ? { followers } : {}),
      ...(follows !== undefined ? { follows } : {}),
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
// nagg also returns minVersion, which @sovranbitcoin/schemas 2.2.0 strips.
// Remove this extension after the shared schema includes it and the app upgrades.
const NaggLatestVersionResponse = LatestVersionResponse.extend({
  minVersion: z.string().max(32).optional(),
});
const parseLatestVersion = parseWith(NaggLatestVersionResponse, 'app/latest-version');
// Move this shape into @sovranbitcoin/schemas in its next release and deprecate
// PricelistWsMessage there. Remove the local schema once the app upgrades.
const NaggRatesResponse = z.looseObject({
  rates: z.record(
    z.string(),
    z.object({
      price: z.number().positive(),
      at: z.number().int(),
      samples: z.number().int().optional(),
      sources: z.array(z.string()).optional(),
      confidence: z.string().optional(),
    })
  ),
  updatedAt: z.number().int(),
  degraded: z.boolean().optional(),
});
const parseRates = parseWith(NaggRatesResponse, 'app/rates');
export const fetchBtcRates = (controls: RequestControls = {}) =>
  fetchJson(`${SCORE_API_BASE_URL}/app/rates`, parseRates, 'app/rates', undefined, controls);

const parseAiLineup = parseWith(NaggAiLineupSchema, 'app/ai-lineup');
const parseDiscoverMints = parseWith(DiscoverMintsResponse, 'nostr/mint/discover');
const parseMintChanges = parseWith(MintChangesResponse, 'nostr/mint/changes');
const parseCatalog = parseWith(CatalogResponse, 'app/wallpapers');

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
const MintInfoSpine = z.looseObject({
  name: z.string(),
  pubkey: z.string(),
  version: z.string(),
  nuts: z.record(z.string(), z.unknown()).optional(),
});

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
 * the app no longer needs separate mint search + per-mint
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

/**
 * nagg mint-info changelog: what every tracked mint changed about its own NUT-06
 * document, newest first. One call covers the whole ecosystem (nagg caps `limit`
 * at 500 and the entire recorded history is well under that), so callers filter
 * the response down to the mints they care about rather than asking per mint.
 */
export const fetchMintChanges = ({
  limit = 500,
  signal,
}: { limit?: number; signal?: AbortSignal } = {}) =>
  fetchJson(
    `${SCORE_API_BASE_URL}/nostr/mint/changes?limit=${limit}`,
    parseMintChanges,
    'nostr/mint/changes',
    undefined,
    { signal }
  );

/** A normalized single-mint lookup; unknown mints return no row. */
export const discoverMint = async (mintUrl: string, controls?: RequestControls) =>
  (
    await fetchJson(
      `${SCORE_API_BASE_URL}/nostr/mint/discover?mint=${encodeURIComponent(mintUrl)}`,
      parseDiscoverMints,
      'nostr/mint/discover',
      undefined,
      controls
    )
  ).map(({ mints }) => mints[0]);

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
 * schema and precedence rules). Served by nagg, so a
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

export const fetchNostrProfile = (
  pubkey: string,
  controls: RequestControls & { signedVertexRequest?: facade.SignedVertexRequest } = {}
) =>
  fetchJson(
    `${SCORE_API_BASE_URL}/nostr/profile?pubkey=${encodeURIComponent(pubkey)}${controls.signedVertexRequest ? `&svr=${facade.encodeSignedVertexRequest(controls.signedVertexRequest)}` : ''}`,
    parseNostrProfileFor(pubkey),
    'nostr/profile',
    controls.signedVertexRequest ? { cache: 'no-store' } : undefined,
    {
      ...controls,
      timeoutMs: controls.timeoutMs ?? (controls.signedVertexRequest ? 20_000 : DEFAULT_TIMEOUT_MS),
    }
  );

/**
 * Fetches nagg's app-module wallpaper catalog using the shared Zod schema.
 * This route does not require nagg's optional Nostr module. wallpaperSync
 * retains the persisted last catalog when the request or parsing fails.
 * Unknown top-level fields are silently dropped (Postel's Law); a malformed
 * envelope is coerced into an `Error` with the parse-issue count for the
 * UI layer and the detail is logged via `loggableIssues`.
 */
export const fetchWallpaperCatalog = (controls: RequestControls = {}) =>
  fetchJson(
    `${SCORE_API_BASE_URL}/app/wallpapers`,
    parseCatalog,
    'app/wallpapers',
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
