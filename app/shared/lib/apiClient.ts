import { facade, NaggIdentitiesSchema, type NaggIdentity } from 'nostr';
import { GetInfoResponse } from '@cashu/cashu-ts';
import {
  combineSignals,
  isAbortError,
  timeoutSignal,
  type MintReviewRecommendation,
  type MintReviewsSummary,
  type RequestControls,
} from 'wallet';
import { ok, err, Result } from 'neverthrow';
import * as nip19 from 'nostr-tools/nip19';
import { z } from 'zod';
import { FIAT_UNITS } from 'wallet/units';
import { apiLog } from './logger';
import {
  CatalogResponse,
  LatestVersionResponse,
  NostrProfileFull as NostrProfileFullStrict,
  TopFollower as TopFollowerStrict,
  loggableIssues,
  type MintRecommendation as SchemaMintRecommendation,
  type MintSearchResult,
  type NostrTier,
  type ParseError,
} from '@sovranbitcoin/schemas';
import { DEFAULT_TIMEOUT_MS } from '@/shared/lib/http/requestSignal';
import { AuditObservationsSchema } from '@/shared/lib/cashu/auditors/observation';

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
export type MintReviewsResponse = {
  mintUrl: string;
  score: number | null;
  recommendations: MintRecommendation[];
  /** The source's own review total. nagg aggregates server-side over every
   *  review it has indexed; a relay answer carries only what its bounded scan
   *  returned, so `recommendations.length` alone under-counts there. */
  reviewCount?: number;
  lastUpdated: number | null;
  fromCache: boolean;
  /** Which tier answered; `degraded` when a fallback tier served it without
   *  reviewer identities (the screen then names reviewers from the entity cache). */
  tier?: NostrTier;
  degraded?: boolean;
};
type MintReviewsResponseType = MintReviewsResponse;
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
  // nagg's unpaid-quote probe saw the mint mark a never-paid quote as paid: a
  // fake payment backend. The row's units are then testnut account units.
  testnut: z.boolean().optional().catch(undefined),
  /** Each auditor's own typed reading of the mint, by source (additive, tolerant). */
  auditObservations: AuditObservationsSchema.optional().catch(undefined),
  /** nagg's own `/v1/info` probe, on the provider directory's terms: `unknown`
   *  when never probed or older than its max age, `checkedAt` omitted while
   *  unknown, `latencyMs` from the last successful probe. Feedback, not a gate. */
  status: z.enum(['online', 'offline', 'unknown']).optional().catch(undefined),
  checkedAt: z.string().max(64).optional().catch(undefined),
  latencyMs: z.number().nonnegative().optional().catch(undefined),
});
export type DiscoverMint = z.infer<typeof DiscoverMint>;
// nagg's per-mint info for the wallet's OWN mints (which discovery's roster
// may not list). `testnut` is a verdict only when `probedAt` is present:
// false without it means "not probed yet", not "real mint".
const MintInfoRow = z.looseObject({
  mintUrl: z.string().max(2048),
  known: z.boolean().optional().catch(undefined),
  testnut: z.boolean(),
  probedAt: z.number().int().nonnegative().optional().catch(undefined),
  /** The NUT-06 nostr contact as nagg resolved it, hex. */
  operatorPubkey: z.string().max(128).optional().catch(undefined),
});
const MintInfoResponse = z.looseObject({
  mints: z.array(MintInfoRow).max(64),
  identities: NaggIdentitiesSchema.optional(),
});
export type MintInfoRow = z.infer<typeof MintInfoRow>;
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
export const DiscoverMintsResponse = z.object({
  mints: z.array(DiscoverMint).max(10_000),
  profiles: z.record(z.string(), ReviewerProfileInfo).optional(),
  /** Operator identity groups, keyed by hex pubkey — see `cacheIdentities`. */
  identities: NaggIdentitiesSchema.optional(),
});
export type DiscoverMintsResponse = z.infer<typeof DiscoverMintsResponse>;

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

/**
 * A response that arrived but failed its schema. Carries the redacted
 * paths+codes only — the raw ParseError can hold the offending input.
 */
export class ApiParseError extends Error {
  readonly where: string;
  readonly issues: ReturnType<typeof loggableIssues>;

  constructor(e: ParseError) {
    super(`${e.where}: ${e.issues.length} schema issue(s)`);
    this.where = e.where;
    this.issues = loggableIssues(e);
  }
}

function toError(e: FetchOrParseError): Error {
  if (e instanceof Error) return e;
  if ((e as ParseError).type === 'schema/zod') return new ApiParseError(e as ParseError);
  return new Error('unknown error');
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
 * and surface as `ApiParseError`, keeping the `Result<T, Error>` signature.
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
  identities: NaggIdentitiesSchema.optional(),
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

/**
 * The profile envelope parsed into the app-facing profile PLUS the identity
 * groups it carried (the subject and its top followers), so the fetcher can
 * hand those to the single owner. `parseNostrProfileFor` below is this minus
 * the identities, for callers that only re-parse a Vertex refresh.
 */
const parseProfileEnvelopeFor =
  (pubkey: string) =>
  (
    input: unknown
  ): Result<
    { profile: NostrProfileFullType; identities: Record<string, NaggIdentity> },
    ParseError
  > => {
    const env = ProfileEnvelope.safeParse(input);
    if (!env.success) {
      return err({ type: 'schema/zod', where: 'nostr/profile', issues: env.error.issues });
    }
    const { events, aggregates, providers, identities, fromCache } = env.data;

    // Latest kind-0 per author (envelope hydration is just more events).
    const k0ByPubkey = new Map<string, (typeof events)[number]>();
    for (const e of events) {
      if (e.kind !== 0) continue;
      const prev = k0ByPubkey.get(e.pubkey);
      // NIP-01: on equal created_at the replaceable event with the lowest id wins.
      if (
        !prev ||
        e.created_at > prev.created_at ||
        (e.created_at === prev.created_at && e.id < prev.id)
      ) {
        k0ByPubkey.set(e.pubkey, e);
      }
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
    // Aggregates omit a zero and are absent without nagg's nostr module; the
    // identity's reach (the shared resolver, null when unresolved) fills in.
    const reach = identities?.[pubkey]?.reach;
    const followers = agg('k3_p_latest', 'actors') ?? num(reach?.followers);
    const follows = agg('k3_author_latest', 'sources') ?? num(reach?.follows);
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
    return ok({ profile: parsed.data, identities: identities ?? {} });
  };

export const parseNostrProfileFor =
  (pubkey: string) =>
  (input: unknown): Result<NostrProfileFullType, ParseError> =>
    parseProfileEnvelopeFor(pubkey)(input).map((r) => r.profile);
// BTC prices: Coinbase first, Mempool.space when Coinbase cannot answer.
// Both are fixed public GETs with no headers or body, so nothing about the
// wallet or account travels with them. A snapshot is accepted only when it
// prices EVERY fiat unit the wallet supports; a partial one is a failure, so
// the cache is never half-refreshed from one provider.
export const COINBASE_BTC_RATES_URL = 'https://api.coinbase.com/v2/exchange-rates?currency=BTC';
export const MEMPOOL_BTC_PRICES_URL = 'https://mempool.space/api/v1/prices';
/** Per-provider ceiling: the fallback must still answer quickly. */
const PRICE_PROVIDER_TIMEOUT_MS = 3_000;
/** Mempool's `time` must be no older than the cache's staleness budget… */
const MEMPOOL_MAX_AGE_SECONDS = 2 * 60 * 60;
/** …and no further ahead than ordinary clock skew. */
const MEMPOOL_MAX_SKEW_SECONDS = 5 * 60;
const PRICE_CODES = FIAT_UNITS.map((unit) => unit.toUpperCase());
/** A plain positive decimal as Coinbase writes it: no sign, exponent or padding. */
const DECIMAL_RATE = /^\d+(?:\.\d+)?$/;

const CoinbaseRatesEnvelope = z.looseObject({
  data: z.looseObject({
    currency: z.literal('BTC'),
    rates: z.record(z.string(), z.string()),
  }),
});

const MempoolPrices = z.looseObject({
  time: z.number().int().positive(),
  ...Object.fromEntries(PRICE_CODES.map((code) => [code, z.number().positive().finite()])),
});

interface BtcRatesResponse {
  rates: Record<string, { price: number; at: number }>;
  updatedAt: number;
  degraded?: boolean;
  /** Which provider answered. */
  source: 'coinbase' | 'mempool';
}

const incomplete = (where: string, path: string[], message: string): ParseError => ({
  type: 'schema/zod',
  where,
  issues: [{ code: 'custom', path, message }],
});

const parseCoinbaseRates = (input: unknown): Result<BtcRatesResponse, ParseError> => {
  const parsed = CoinbaseRatesEnvelope.safeParse(input);
  if (!parsed.success) {
    return err({
      type: 'schema/zod',
      where: 'coinbase/exchange-rates',
      issues: parsed.error.issues,
    });
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const rates: Record<string, { price: number; at: number }> = {};
  for (const code of PRICE_CODES) {
    const raw = Object.hasOwn(parsed.data.data.rates, code)
      ? parsed.data.data.rates[code]
      : undefined;
    const price = raw !== undefined && DECIMAL_RATE.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isFinite(price) || price <= 0) {
      return err(
        incomplete('coinbase/exchange-rates', ['data', 'rates', code], 'missing or invalid rate')
      );
    }
    rates[code] = { price, at: nowSec };
  }
  return ok({ rates, updatedAt: nowSec, source: 'coinbase' });
};

const parseMempoolPrices = (input: unknown): Result<BtcRatesResponse, ParseError> => {
  const parsed = MempoolPrices.safeParse(input);
  if (!parsed.success) {
    return err({ type: 'schema/zod', where: 'mempool/prices', issues: parsed.error.issues });
  }
  const time = parsed.data.time;
  const nowSec = Math.floor(Date.now() / 1000);
  if (time < nowSec - MEMPOOL_MAX_AGE_SECONDS || time > nowSec + MEMPOOL_MAX_SKEW_SECONDS) {
    return err(incomplete('mempool/prices', ['time'], 'outside the accepted window'));
  }
  const prices = parsed.data as Record<string, unknown>;
  const rates: Record<string, { price: number; at: number }> = {};
  for (const code of PRICE_CODES) rates[code] = { price: prices[code] as number, at: time };
  return ok({ rates, updatedAt: time, source: 'mempool' });
};

/**
 * Complete BTC prices for every supported fiat unit. Coinbase answers first;
 * any HTTP, network, timeout, JSON or schema failure falls through to
 * Mempool.space, unless the caller aborted. Each request gets its own
 * three-second ceiling and the caller's signal. When both fail, Coinbase's
 * error is returned, so the feed backs off on the primary provider's status.
 */
export const fetchBtcRates = async (
  controls: RequestControls = {}
): Promise<Result<BtcRatesResponse, Error>> => {
  const providerControls = {
    signal: controls.signal,
    timeoutMs: controls.timeoutMs ?? PRICE_PROVIDER_TIMEOUT_MS,
  };
  const primary = await fetchJson(
    COINBASE_BTC_RATES_URL,
    parseCoinbaseRates,
    'coinbase/exchange-rates',
    undefined,
    providerControls
  );
  if (primary.isOk() || controls.signal?.aborted) return primary;
  apiLog.warn('api.btc_rates.fallback', {
    from: 'coinbase',
    to: 'mempool',
    status: primary.error instanceof ApiHttpError ? primary.error.status : null,
  });
  const fallback = await fetchJson(
    MEMPOOL_BTC_PRICES_URL,
    parseMempoolPrices,
    'mempool/prices',
    undefined,
    providerControls
  );
  return fallback.isOk() ? fallback : primary;
};

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
 * Multi-auditor mint discovery: merges results from all enabled auditors
 * (Nostr NIP-87, MintRadar, Cashu Auditor, IMF.gg) respecting per-auditor
 * settings in `settingsStore.disabledMintAuditors`.
 */
export const discoverMints = ({ limit, signal }: { limit?: number; signal?: AbortSignal } = {}) => {
  const { discoverMintsFromAuditors } = require('@/shared/lib/cashu/auditors/discoverMints') as {
    discoverMintsFromAuditors: typeof import('@/shared/lib/cashu/auditors/discoverMints').discoverMintsFromAuditors;
  };
  const { useSettingsStore } = require('@/shared/stores/global/settingsStore') as {
    useSettingsStore: typeof import('@/shared/stores/global/settingsStore').useSettingsStore;
  };
  const settings = useSettingsStore.getState();
  return discoverMintsFromAuditors({
    disabledAuditors: settings.disabledMintAuditors,
    enabledAuditors: settings.enabledMintAuditors,
    limit,
    signal,
  });
};

/** Batch cap for direct NUT-06 `/v1/info` probes. */
export const MINT_INFO_MAX_URLS = 50;

/**
 * Resolve mint testnut verdicts locally via NUT-04 unpaid-quote probes (plus
 * known testnut hosts), falling back to enabled auditors only for mints that
 * did not answer the local probe. Never downgrades a saved testnut verdict
 * without a fresh probe.
 */
export const fetchMintInfos = async (
  mintUrls: readonly string[],
  controls?: RequestControls
): Promise<Result<z.infer<typeof MintInfoResponse>['mints'], Error>> => {
  const { normalizeMintUrlKey } = require('@/shared/lib/url') as {
    normalizeMintUrlKey: typeof import('@/shared/lib/url').normalizeMintUrlKey;
  };
  const { useMintTestnutStore } = require('@/shared/stores/global/mintTestnutStore') as {
    useMintTestnutStore: typeof import('@/shared/stores/global/mintTestnutStore').useMintTestnutStore;
  };
  const { probeMintTestnut } = require('@/shared/lib/cashu/testnutProbe') as {
    probeMintTestnut: typeof import('@/shared/lib/cashu/testnutProbe').probeMintTestnut;
  };

  const existing = useMintTestnutStore.getState().byMintUrl;
  const nowSec = Math.floor(Date.now() / 1000);

  // Run local NUT-04 unpaid-quote probes with bounded concurrency (max 4).
  const probeResults = new Map<string, boolean | null>();
  const CONCURRENCY = 4;
  for (let i = 0; i < mintUrls.length; i += CONCURRENCY) {
    const batch = mintUrls.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (mintUrl) => {
        const verdict = await probeMintTestnut(mintUrl, { signal: controls?.signal });
        return [mintUrl, verdict] as const;
      })
    );
    for (const [mintUrl, verdict] of settled) {
      probeResults.set(mintUrl, verdict);
    }
  }

  // Only consult multi-auditor discovery for mints whose local probe was indeterminate.
  const unresolved = mintUrls.filter((mintUrl) => probeResults.get(mintUrl) === null);
  let auditorByKey = new Map<string, DiscoverMint>();
  if (unresolved.length > 0 && !controls?.signal?.aborted) {
    const discovered = await discoverMints({ signal: controls?.signal });
    if (discovered.isOk()) {
      auditorByKey = new Map(
        discovered.value.mints.map((m) => [normalizeMintUrlKey(m.mintUrl), m] as const)
      );
    }
  }

  return ok(
    mintUrls.map((mintUrl) => {
      const key = normalizeMintUrlKey(mintUrl);
      const localVerdict = probeResults.get(mintUrl) ?? null;
      const found = auditorByKey.get(key);
      const saved = existing[key];
      const hasAuditedVerdict = found?.hasAudit === true && typeof found.testnut === 'boolean';
      const hasVerdict = localVerdict !== null || hasAuditedVerdict;
      const testnut =
        localVerdict !== null
          ? saved?.testnut === true
            ? true
            : localVerdict
          : saved?.testnut === true
            ? true
            : hasAuditedVerdict
              ? (found.testnut as boolean)
              : false;
      return {
        mintUrl,
        testnut,
        known: localVerdict !== null || Boolean(found),
        ...(hasVerdict ? { probedAt: nowSec } : {}),
        ...(found?.operatorPubkey ? { operatorPubkey: found.operatorPubkey } : {}),
      };
    })
  );
};

/** Single-mint discovery lookup across enabled public auditors. */
export const discoverMint = async (
  mintUrl: string,
  controls?: RequestControls
): Promise<Result<DiscoverMint | undefined, Error>> => {
  const { normalizeMintUrlKey } = require('@/shared/lib/url') as {
    normalizeMintUrlKey: typeof import('@/shared/lib/url').normalizeMintUrlKey;
  };
  const target = normalizeMintUrlKey(mintUrl);
  const res = await discoverMints({ signal: controls?.signal });
  return res.map(({ mints }) => mints.find((m) => normalizeMintUrlKey(m.mintUrl) === target));
};

/**
 * Reviews for one mint directly via the Nostr data layer (Primal → relays).
 */
export const reviewMint = async ({
  mintUrl,
  signal,
}: {
  mintUrl: string;
  signal?: AbortSignal;
}): Promise<Result<MintReviewsResponseType, Error>> => {
  const { buildNostrDataLayer } = require('@/shared/lib/nostr/buildNostrDataLayer') as {
    buildNostrDataLayer: typeof import('@/shared/lib/nostr/buildNostrDataLayer').buildNostrDataLayer;
  };
  const layer = buildNostrDataLayer();
  if (!layer) return ok(normalizeMintReviewsSummary(mintUrl, undefined));
  const res = await layer.getMintReviews({ mintUrl, signal });
  if (res.isErr()) return err(new Error(res.error.message));
  return ok(
    normalizeMintReviewsSummary(mintUrl, {
      mintUrl,
      reviews: res.value.reviews.map((r) => ({
        id: r.eventId,
        pubkey: r.reviewerPubkey,
        content: r.content,
        rating: r.score ?? undefined,
        created_at: r.createdAtSec,
      })),
      averageScore: res.value.averageScore ?? 0,
      reviewCount: res.value.reviews.length,
    } as unknown as MintReviewsSummary)
  );
};

/** App updates are delivered by the platform store (App Store, Play Store, Zapstore). */
export const getLatestVersion = (_args: {
  storage: { version: string };
  signal?: AbortSignal;
}): Promise<Result<z.infer<typeof LatestVersionResponse> & { minVersion?: string }, Error>> =>
  Promise.resolve(err(new Error('App updates are delivered through your app store')));

/**
 * Fetch a Nostr profile directly via the Nostr data layer (Primal → relays).
 */
export const fetchNostrProfile = async (
  pubkey: string,
  controls: RequestControls & { signedVertexRequest?: facade.SignedVertexRequest } = {}
): Promise<Result<NostrProfileFullType, Error>> => {
  const { buildNostrDataLayer } = require('@/shared/lib/nostr/buildNostrDataLayer') as {
    buildNostrDataLayer: typeof import('@/shared/lib/nostr/buildNostrDataLayer').buildNostrDataLayer;
  };
  const layer = buildNostrDataLayer();
  if (!layer) return err(new Error('Nostr data layer unavailable'));
  const [profilesRes, statsRes] = await Promise.all([
    layer.getProfiles({ pubkeys: [pubkey], signal: controls.signal }),
    layer.getProfileStats({ pubkey, signal: controls.signal }),
  ]);
  const meta = profilesRes.isOk() ? profilesRes.value.profiles[pubkey] : undefined;
  const stats = statsRes.isOk() ? statsRes.value : undefined;
  if (!meta && !stats) {
    return err(new Error('Profile not found on enabled Nostr tiers'));
  }
  let npub = '';
  try {
    npub = nip19.npubEncode(pubkey);
  } catch {
    npub = pubkey;
  }
  const profile: NostrProfileFullType = {
    pubkey,
    npub,
    rank: 0,
    fromCache: false,
    score: null,
    created_at: stats?.joinedAtSec ?? null,
    topFollowers: [],
    name: meta?.name ?? '',
    displayName: meta?.displayName ?? meta?.name ?? '',
    about: meta?.about ?? '',
    picture: meta?.picture ?? '',
    banner: meta?.banner ?? '',
    nip05: meta?.nip05 ?? '',
    lud16: meta?.lud16 ?? '',
    website: meta?.website ?? '',
    followers: stats?.followersCount,
    follows: stats?.followingCount,
  };
  return ok(profile);
};

/** Wallpapers are bundled locally; remote catalog fetching is disabled. */
export const fetchWallpaperCatalog = (
  _controls: RequestControls = {}
): Promise<Result<z.infer<typeof CatalogResponse>, Error>> =>
  Promise.resolve(err(new Error('Remote wallpaper catalog disabled')));

// ---------------------------------------------------------------------------
// Mint `/v1/info` — upstream Cashu shape, owned by `@cashu/cashu-ts`.
//
// `MintInfoSpine` runs at the boundary so a hostile or misconfigured mint
// can't ship a non-string `name` past the validator; the full `GetInfoResponse`
// type is owned by cashu-ts. Cancellation, timeout, and HTTP error mapping
// share the canonical `fetchJson` scaffolding.
// ---------------------------------------------------------------------------

/**
 * The `https:` base of a mint, with its trailing slash. Defence-in-depth: the
 * helpers below dial arbitrary user-supplied hosts, and callers normalize the
 * URL, but a stray `http://` or `file://` would otherwise sail through to
 * `fetch`, so the policy is enforced here regardless of which call site forgot.
 */
function httpsMintBase(mintUrl: string): Result<string, Error> {
  let parsed: URL;
  try {
    parsed = new URL(mintUrl);
  } catch {
    return err(new Error('Invalid mint URL'));
  }
  if (parsed.protocol !== 'https:') {
    apiLog.warn('api.mint_info_scheme_rejected', {
      host: parsed.host,
      protocol: parsed.protocol,
    });
    return err(new Error(`Mint URL must use https: (got ${parsed.protocol})`));
  }
  return ok(mintUrl.endsWith('/') ? mintUrl : `${mintUrl}/`);
}

export const fetchMintInfo = async (
  mintUrl: string,
  controls: RequestControls = {}
): Promise<Result<GetInfoResponse, Error>> => {
  const base = httpsMintBase(mintUrl);
  if (base.isErr()) return err(base.error);
  // The profile and session the request is made in: an answer that lands
  // after a switch (even A → B → A) or Delete All is not recorded.
  const { activePubkey } = require('@/shared/stores/global/profileStore') as {
    activePubkey: typeof import('@/shared/stores/global/profileStore').activePubkey;
  };
  const owner = activePubkey();
  const { mintHistoryGeneration, observeMintInfoResponse } =
    require('@/features/mint/lib/mintHistorySync') as typeof import('@/features/mint/lib/mintHistorySync');
  const generation = mintHistoryGeneration();
  const result = await fetchJson(
    `${base.value}v1/info`,
    parseMintInfo,
    'cashu/mint/info',
    { headers: { Accept: 'application/json' } },
    controls
  );
  if (result.isOk() && owner) {
    // Every validated `/v1/info` answer is a mint-history observation.
    void observeMintInfoResponse(mintUrl, result.value, { owner, generation }).catch(
      (error: unknown) => {
        apiLog.warn('api.mint_history_observe_failed', {
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    );
  }
  return result;
};

// NUT-02 `/v1/keysets`: only the fields Mint Info reads (unit, active, fee).
const MintKeysetsResponse = z.looseObject({
  keysets: z
    .array(
      z.looseObject({
        id: z.string().max(128),
        unit: z.string().max(32),
        active: z.boolean(),
        input_fee_ppk: z.number().int().nonnegative().optional().catch(undefined),
      })
    )
    .max(256),
});
type MintKeysetsResponse = z.infer<typeof MintKeysetsResponse>;

const parseMintKeysets = (input: unknown): Result<MintKeysetsResponse, ParseError> => {
  const r = MintKeysetsResponse.safeParse(input);
  if (!r.success) {
    return err({ type: 'schema/zod', where: 'cashu/mint/keysets', issues: r.error.issues });
  }
  return ok(r.data);
};

/** A mint's keysets straight from the mint, for one it is not in the wallet yet. */
export const fetchMintKeysets = (
  mintUrl: string,
  controls: RequestControls = {}
): Promise<Result<MintKeysetsResponse, Error>> => {
  const base = httpsMintBase(mintUrl);
  if (base.isErr()) return Promise.resolve(err(base.error));
  return fetchJson(
    `${base.value}v1/keysets`,
    parseMintKeysets,
    'cashu/mint/keysets',
    { headers: { Accept: 'application/json' } },
    controls
  );
};
