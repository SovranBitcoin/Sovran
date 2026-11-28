import { ok, err, type Result } from 'neverthrow';
import type { NostrTier } from '@sovranbitcoin/schemas';
import {
  resolveAcrossTiers,
  resolveAllTiers,
  tierRank,
  type ReadProvenance,
  type TierAggregate,
  type TierCandidate,
  type TierReadContext,
  type TierResolutionError,
} from '../tiers';
import { nostrLog, type NostrLogData } from '../log';
import type { RequestControls } from '../timeout';
import {
  dedupeByReviewer,
  type DiscoverMintsRequest,
  type DiscoveredMint,
  type MintReview,
  type MintReviewsRequest,
  type MintReviewsSummary,
  ResolvedDiscoveredMints,
  ResolvedMintReviews,
} from './mint-reviews';
import type { SocialGraph, SocialGraphRequest, ResolvedSocialGraph } from './social-graph';
import type { DmEnvelope, DmEnvelopesBundle, DmEnvelopesRequest, ResolvedDmEnvelopes } from './dm';
import type { ProfileMetadata, ProfilesBundle, ProfilesRequest, ResolvedProfiles } from './profiles';
import {
  profileStatsIsEmpty,
  type ProfileStats,
  type ProfileStatsBundle,
  type ProfileStatsRequest,
  type ResolvedProfileStats,
} from './profile-stats';
import type { ProfileSearchBundle, ProfileSearchHit, SearchRequest, ResolvedProfileSearch } from './search';
import type { NostrTierStrategy } from './strategy';
import {
  createNostrEntityCache,
  type NostrEntityCache,
  type EntityCacheLimits,
  type CachedProfile,
} from './cache/entity-cache';
import {
  ingestSocialGraph,
  ingestProfiles,
  ingestProfileStats,
  ingestSearchHits,
  ingestIdentities,
} from './cache/ingest';

// ---------------------------------------------------------------------------
// NostrDataLayer — the opinionated facade
//
// The single entry point for Nostr reads, expressed in domain terms. It owns
// tier selection (the fallback engine) and cross-tier merging;
// callers never choose a tier or assemble events. Each read builds its tier list
// from the strategies that implement that surface, in the configured order.
// ---------------------------------------------------------------------------

export type NostrDataLayerConfig = {
  /** Strategies tried in order. Conventionally [nagg, primal, relay]. */
  tiers: ReadonlyArray<NostrTierStrategy>;
  /**
   * Shared entity cache. Reads write their entities through it and (where
   * supported) serve from it first. Pass one in to control its lifecycle —
   * the app supplies a PROFILE-SCOPED instance and clears it on identity switch.
   * Created with defaults when omitted.
   */
  cache?: NostrEntityCache;
  cacheLimits?: EntityCacheLimits;
};

export interface NostrDataLayer {
  /** The shared additive entity cache this layer populates. Read/subscribe from a binding. */
  readonly cache: NostrEntityCache;
  getMintReviews(
    request: MintReviewsRequest,
  ): Promise<Result<ResolvedMintReviews, TierResolutionError>>;
  discoverMints(
    request: DiscoverMintsRequest,
  ): Promise<Result<ResolvedDiscoveredMints, TierResolutionError>>;
  getSocialGraph(
    request: SocialGraphRequest,
  ): Promise<Result<ResolvedSocialGraph, TierResolutionError>>;
  getDmEnvelopes(
    request: DmEnvelopesRequest,
  ): Promise<Result<ResolvedDmEnvelopes, TierResolutionError>>;
  /**
   * Live push of DM envelopes (gift wraps) addressed to the viewer — relay-only,
   * a no-op when no relay tier is configured. Pairs with `getDmEnvelopes` for a
   * poll backstop (no auto-reconnect). Returns an unsubscribe.
   */
  subscribeDmEnvelopes(
    request: DmEnvelopesRequest,
    onEnvelope: (envelope: DmEnvelope) => void,
  ): () => void;
  getProfiles(request: ProfilesRequest): Promise<Result<ResolvedProfiles, TierResolutionError>>;
  getProfileStats(
    request: ProfileStatsRequest,
  ): Promise<Result<ResolvedProfileStats, TierResolutionError>>;
  searchProfiles(
    request: SearchRequest,
  ): Promise<Result<ResolvedProfileSearch, TierResolutionError>>;
}

export function createNostrDataLayer(config: NostrDataLayerConfig): NostrDataLayer {
  const tierNames = config.tiers.map((t) => t.tier);
  nostrLog.info('nostr.facade.created', { tiers: tierNames });
  const cache = config.cache ?? createNostrEntityCache(config.cacheLimits);

  const dmLiveTier = config.tiers.find((t) => typeof t.dmLiveSubscribe === 'function');

  return {
    cache,

    async getMintReviews(request) {
      return runRead(
        'mintReviews',
        request,
        { mintUrl: request.mintUrl },
        async (ctx) => {
          const candidates = candidatesFor<MintReviewsSummary>(config.tiers, 'getMintReviews', (t) => () => t.getMintReviews!(request));
          const mergeReviews = mergeMintReviews();
          const resolvedOf = (agg: TierAggregate<MintReviewsSummary>): ResolvedMintReviews => ({
            tier: agg.tier,
            ...agg.value,
            provenance: provenanceOf(ctx.readId, agg),
          });
          return (
            await resolveAllTiers<MintReviewsSummary>(candidates, {
              ...ctx,
              gate: { minItems: 1, capMs: AGGREGATE_CAP_MS.mintReviews },
              count: (summary) => summary.reviewCount,
              // Reviewer and operator identities ride on nagg's answer; written
              // through so the reviewer rows show the same reputation the
              // search list and profile page do.
              merge: (acc, next, tier) => {
                if (next.identities) ingestIdentities(cache, next.identities, tier);
                return mergeReviews(acc, next, tier);
              },
              onUpdate: (agg) => request.onUpdate?.(resolvedOf(agg)),
            })
          ).map(resolvedOf);
        },
        (r) => ({ reviewCount: r.reviewCount, averageScore: r.averageScore, ...describeProvenance(r.provenance) }),
      );
    },

    async discoverMints(request) {
      return runRead(
        'discoverMints',
        request,
        { limit: request.limit ?? null },
        async (ctx) => {
          const candidates = candidatesFor<DiscoveredMint[]>(config.tiers, 'discoverMints', (t) => () => t.discoverMints!(request));
          return (await resolveAcrossTiers<DiscoveredMint[]>(candidates, ctx)).map(({ tier, value }) => ({ tier, mints: value }));
        },
        (r) => ({ mints: r.mints.length }),
      );
    },

    async getSocialGraph(request) {
      return runRead(
        'socialGraph',
        request,
        { pubkey: short(request.pubkey) },
        async (ctx) => {
          const candidates = candidatesFor<SocialGraph>(config.tiers, 'getSocialGraph', (t) => () => t.getSocialGraph!(request));
          const resolvedOf = (agg: TierAggregate<SocialGraph>): ResolvedSocialGraph => ({
            tier: agg.tier,
            ...agg.value,
            provenance: provenanceOf(ctx.readId, agg),
          });
          return (
            await resolveAllTiers<SocialGraph>(candidates, {
              ...ctx,
              gate: { minItems: 1, capMs: AGGREGATE_CAP_MS.socialGraph },
              count: (graph) => graph.follows.length,
              merge: (acc, next, tier) => {
                // Every answer's profiles are cached under their own tier's rank.
                ingestSocialGraph(cache, { tier, ...next });
                return mergeSocialGraph(acc, next, tier);
              },
              onUpdate: (agg) => request.onUpdate?.(resolvedOf(agg)),
            })
          ).map(resolvedOf);
        },
        (g) => ({
          follows: g.follows.length,
          profiles: Object.keys(g.profiles).length,
          mutes: g.mutes.length,
          ...describeProvenance(g.provenance),
        }),
      );
    },

    async getDmEnvelopes(request) {
      return runRead(
        'dmEnvelopes',
        request,
        { viewer: short(request.viewerPubkey), paged: !!request.cursor },
        async (ctx) => {
          const candidates = candidatesFor<DmEnvelopesBundle>(config.tiers, 'getDmEnvelopes', (t) => () => t.getDmEnvelopes!(request));
          return (await resolveAcrossTiers<DmEnvelopesBundle>(candidates, ctx)).map(({ tier, value }) => ({ tier, envelopes: value.envelopes, cursor: value.cursor, ...(value.received === undefined ? {} : { received: value.received }) }));
        },
        (d) => ({ envelopes: d.envelopes.length }),
      );
    },

    subscribeDmEnvelopes(request, onEnvelope) {
      return dmLiveTier ? dmLiveTier.dmLiveSubscribe!(request, onEnvelope) : () => {};
    },

    async getProfiles(request) {
      return runRead(
        'profiles',
        request,
        { pubkeys: request.pubkeys.length },
        async (ctx) => {
          // Cache-first: split into what we already hold vs what to fetch.
          const { profiles: cached, missing } = cache.readProfiles(request.pubkeys);
          const cachedMeta = metadataMapOf(cached);
          // Everything already cached → serve instantly, no network round-trip.
          if (missing.length === 0 && !request.refresh) {
            return ok<ResolvedProfiles, TierResolutionError>({ tier: 'cache', profiles: cachedMeta });
          }
          // Otherwise fan out for the missing (or all, on refresh) and merge:
          // Primal answers most, relays fill the rest. Mark those pubkeys pending
          // so a binding shows a skeleton (not a fallback) until every tier has
          // settled — a slower tier may still fill a gap the first one left.
          const toFetch = request.refresh ? request.pubkeys : missing;
          const fetchReq = request.refresh ? request : { ...request, pubkeys: missing };
          cache.pendingProfiles.begin(toFetch);
          const candidates = candidatesFor<ProfilesBundle>(config.tiers, 'getProfiles', (t) => () => t.getProfiles!(fetchReq));
          const first = await resolveAllTiers<ProfilesBundle>(candidates, {
            ...ctx,
            gate: { minItems: toFetch.length, capMs: AGGREGATE_CAP_MS.profiles },
            count: (bundle) => Object.keys(bundle.profiles).length,
            merge: (acc, next, tier) => {
              // Each answer is cached with its own event times: the cache keeps the newest kind-0.
              ingestProfiles(cache, { tier, profiles: next.profiles, createdAt: next.createdAt });
              return mergeProfileBundles(acc, next, tier);
            },
            onUpdate: (agg) => {
              if (agg.complete) cache.pendingProfiles.end(toFetch);
            },
          });
          if (first.isErr()) {
            cache.pendingProfiles.end(toFetch);
            return err(first.error);
          }
          if (first.value.complete) cache.pendingProfiles.end(toFetch);
          return ok<ResolvedProfiles, TierResolutionError>({
            tier: first.value.tier,
            profiles: { ...cachedMeta, ...first.value.value.profiles },
            provenance: provenanceOf(ctx.readId, first.value),
          });
        },
        (r) => ({ profiles: Object.keys(r.profiles).length, ...describeProvenance(r.provenance) }),
      );
    },

    async getProfileStats(request) {
      return runRead(
        'profileStats',
        request,
        { pubkey: short(request.pubkey) },
        async (ctx) => {
          // Cache-first: if we fetched this header before, serve it now —
          // overlaying the freshest accumulated profile metadata.
          const cachedStats = cache.getProfileStats(request.pubkey);
          if (cachedStats && !request.refresh && !profileStatsIsEmpty(cachedStats)) {
            const freshProfile = cache.getProfile(request.pubkey);
            return ok<ResolvedProfileStats, TierResolutionError>({
              tier: 'cache',
              ...cachedStats,
              metadata: freshProfile ? metadataOf(freshProfile) : cachedStats.metadata,
            });
          }
          cache.pendingProfiles.begin([request.pubkey]);
          const candidates = candidatesFor<ProfileStatsBundle>(config.tiers, 'getProfileStats', (t) => () => t.getProfileStats!(request));
          const resolvedOf = (agg: TierAggregate<ProfileStatsBundle>): ResolvedProfileStats => ({
            tier: agg.tier,
            ...agg.value,
            provenance: provenanceOf(ctx.readId, agg),
          });
          // Counts are unknown, never zero: each tier fills only the fields the
          // earlier ones left undefined, and the merged header is re-cached on
          // every answer so a binding on the entity cache sees counts land one
          // at a time.
          const first = await resolveAllTiers<ProfileStatsBundle>(candidates, {
            ...ctx,
            gate: { minItems: 1, capMs: AGGREGATE_CAP_MS.profileStats },
            count: (stats) => (profileStatsIsEmpty(stats) ? 0 : 1),
            merge: (acc, next, tier) => {
              const merged = mergeProfileStats(acc, next);
              ingestProfileStats(cache, { tier, ...merged });
              return merged;
            },
            onUpdate: (agg) => {
              if (agg.complete) cache.pendingProfiles.end([request.pubkey]);
            },
          });
          if (first.isErr()) {
            cache.pendingProfiles.end([request.pubkey]);
            return err(first.error);
          }
          if (first.value.complete) cache.pendingProfiles.end([request.pubkey]);
          return ok<ResolvedProfileStats, TierResolutionError>(resolvedOf(first.value));
        },
        (r) => ({
          hasMetadata: !!r.metadata,
          followers: r.followersCount ?? null,
          following: r.followingCount ?? null,
          joinedAtSec: r.joinedAtSec ?? null,
          ...describeProvenance(r.provenance),
        }),
      );
    },

    async searchProfiles(request) {
      return runRead(
        'searchProfiles',
        request,
        { q: request.query.length, limit: request.limit ?? null },
        async (ctx) => {
          const candidates = candidatesFor<ProfileSearchBundle>(config.tiers, 'searchProfiles', (t) => () => t.searchProfiles!(request));
          const mergeBundles = mergeSearchBundles();
          const resolvedOf = (agg: TierAggregate<ProfileSearchBundle>): ResolvedProfileSearch => ({
            tier: agg.tier,
            ...agg.value,
            provenance: provenanceOf(ctx.readId, agg),
          });
          return (
            await resolveAllTiers<ProfileSearchBundle>(candidates, {
              ...ctx,
              // A full page from one tier paints at once; otherwise the first
              // answer paints at the cap. Painting on the first single hit
              // and appending the rest a moment later reads as a flicker.
              gate: { minItems: request.limit ?? 10, capMs: AGGREGATE_CAP_MS.searchProfiles },
              count: (bundle) => bundle.hits.length,
              // Every tier's hits are written through as they land: a score
              // or follower count seen in search is then the one the profile
              // page, a mint row or a provider row shows for the same pubkey.
              merge: (acc, next, tier) => {
                ingestSearchHits(cache, next.hits, tier);
                return mergeBundles(acc, next, tier);
              },
              onUpdate: (agg) => request.onUpdate?.(resolvedOf(agg)),
            })
          ).map(resolvedOf);
        },
        (r) => ({ hits: r.hits.length, ...describeProvenance(r.provenance) }),
      );
    },

  };
}

let readSeq = 0;
/** Facade-minted correlation id when the caller did not supply one: `f<seq>-<surface>`. */
function mintReadId(surface: string): string {
  readSeq += 1;
  return `f${readSeq.toString(36)}-${surface}`;
}

/**
 * Log a read's request + outcome (answering tier + counts, or the exhaustion
 * trail), correlated by `readId` so log-doctor can join the `nostr.tier.*`
 * attempts underneath it. The id is the caller's (`RequestControls.readId`)
 * when present, otherwise minted here.
 */
async function runRead<R extends { tier: NostrTier }>(
  surface: string,
  request: RequestControls,
  summary: NostrLogData,
  run: (ctx: Required<TierReadContext>) => Promise<Result<R, TierResolutionError>>,
  describe: (resolved: R) => NostrLogData,
): Promise<Result<R, TierResolutionError>> {
  const ctx = { readId: request.readId ?? mintReadId(surface), surface };
  const startedAt = Date.now();
  nostrLog.info(`nostr.read.${surface}.request`, { readId: ctx.readId, ...summary });
  const result = await run(ctx);
  const durationMs = Date.now() - startedAt;
  result.match(
    (resolved) =>
      nostrLog.info(`nostr.read.${surface}.done`, {
        readId: ctx.readId,
        tier: resolved.tier,
        durationMs,
        ...describe(resolved),
      }),
    (error) =>
      nostrLog.warn(`nostr.read.${surface}.exhausted`, {
        readId: ctx.readId,
        durationMs,
        attempts: error.attempts.map((a) => `${a.tier}=${a.outcome}`),
      }),
  );
  return result;
}


// ---------------------------------------------------------------------------
// Aggregate surfaces — gap-fill merges
//
// These reads fan out to every tier (see tiers/aggregate.ts). Each merge is
// idempotent and APPEND-ONLY: a later answer may add entries or fill blanks,
// never move or erase what an earlier answer painted.
// ---------------------------------------------------------------------------

/** First-paint caps per aggregate surface (ms). Paint waits for the first answer regardless. */
const AGGREGATE_CAP_MS = {
  profiles: 800,
  profileStats: 1000,
  searchProfiles: 300,
  mintReviews: 800,
  socialGraph: 800,
} as const;

function provenanceOf<T>(readId: string, agg: TierAggregate<T>): ReadProvenance {
  return {
    readId,
    sources: agg.sources,
    attempts: agg.attempts,
    degraded: agg.degraded,
    complete: agg.complete,
  };
}

function describeProvenance(provenance: ReadProvenance | undefined): NostrLogData {
  if (!provenance) return {};
  return {
    sources: provenance.sources,
    degraded: provenance.degraded,
    complete: provenance.complete,
  };
}

/**
 * Union by pubkey, newest kind-0 wins: an answer replaces what is held for a
 * pubkey only when its event is newer, or as new and from a better-ranked
 * tier. An answer that does not know its event time ranks below any that does.
 */
function mergeProfileBundles(
  acc: ProfilesBundle | undefined,
  next: ProfilesBundle,
  tier: NostrTier,
): ProfilesBundle {
  if (!acc) {
    for (const metadata of Object.values(next.profiles)) rankOwners.set(metadata, tier);
    return { profiles: { ...next.profiles }, createdAt: { ...next.createdAt } };
  }
  const profiles = { ...acc.profiles };
  const createdAt = { ...acc.createdAt };
  for (const [pubkey, metadata] of Object.entries(next.profiles)) {
    const existing = profiles[pubkey];
    const nextAt = next.createdAt?.[pubkey] ?? 0;
    const heldAt = createdAt[pubkey] ?? 0;
    const wins =
      !existing ||
      nextAt > heldAt ||
      (nextAt === heldAt && tierRank(tier) <= tierRank(rankOwner(existing)));
    if (!wins) continue;
    profiles[pubkey] = metadata;
    if (nextAt > 0) createdAt[pubkey] = nextAt;
    rankOwners.set(metadata, tier);
  }
  return { profiles, createdAt };
}
// Which tier supplied a metadata object, to break a tie between two answers
// for the same event. Keyed weakly on the object itself: no ids, no leaks.
const rankOwners = new WeakMap<object, NostrTier>();
function rankOwner(metadata: object): NostrTier {
  return rankOwners.get(metadata) ?? 'relay';
}


/** Fill only the fields the earlier answers left undefined; never overwrite a number with undefined. */
function mergeProfileStats(acc: ProfileStats | undefined, next: ProfileStats): ProfileStats {
  if (!acc) return { ...next };
  return {
    pubkey: acc.pubkey,
    // The kind-0 is a replaceable event: the newer one is the header's.
    ...newerMetadata(acc, next),
    followersCount: acc.followersCount ?? next.followersCount,
    followingCount: acc.followingCount ?? next.followingCount,
    noteCount: acc.noteCount ?? next.noteCount,
    joinedAtSec: acc.joinedAtSec ?? next.joinedAtSec,
    score: acc.score ?? next.score,
    rank: acc.rank ?? next.rank,
    vertexFetchedAt: acc.vertexFetchedAt ?? next.vertexFetchedAt,
    operatesMints: acc.operatesMints ?? next.operatesMints,
    operatesAiProviders: acc.operatesAiProviders ?? next.operatesAiProviders,
  };
}

function newerMetadata(
  acc: ProfileStats,
  next: ProfileStats,
): Pick<ProfileStats, 'metadata' | 'metadataCreatedAt'> {
  const from =
    next.metadata && (!acc.metadata || (next.metadataCreatedAt ?? 0) > (acc.metadataCreatedAt ?? 0))
      ? next
      : acc;
  return { metadata: from.metadata, metadataCreatedAt: from.metadataCreatedAt };
}

/**
 * Union by pubkey in arrival order — painted rows keep their index; a later
 * tier appends only pubkeys not yet shown. A better-ranked later answer
 * upgrades an existing hit's rank/score/counts in place (no reorder).
 */
function mergeSearchBundles(): (
  acc: ProfileSearchBundle | undefined,
  next: ProfileSearchBundle,
  tier: NostrTier,
) => ProfileSearchBundle {
  let bestRank: number | null = null;
  return (acc, next, tier) => {
    const rank = tierRank(tier);
    const upgrades = bestRank === null || rank < bestRank;
    if (upgrades) bestRank = rank;
    if (!acc) return { hits: [...next.hits], vertexFresh: next.vertexFresh ?? null };
    const index = new Map<string, number>();
    acc.hits.forEach((hit, i) => index.set(hit.pubkey, i));
    const hits: ProfileSearchHit[] = [...acc.hits];
    for (const hit of next.hits) {
      const at = index.get(hit.pubkey);
      if (at === undefined) {
        index.set(hit.pubkey, hits.length);
        hits.push(hit);
      } else if (upgrades) {
        hits[at] = mergeSearchHit(hits[at]!, hit);
      }
    }
    return {
      hits,
      vertexFresh: upgrades ? (next.vertexFresh ?? acc.vertexFresh ?? null) : (acc.vertexFresh ?? next.vertexFresh ?? null),
    };
  };
}

/**
 * A better-ranked hit upgrades a painted one field by field, but a figure the
 * new tier could NOT measure (`null`) never erases one an earlier tier did:
 * a Vertex-only answer knows the score and nothing about followers, and a
 * follower count is not wrong because the DVM did not repeat it.
 */
export function mergeSearchHit(base: ProfileSearchHit, hit: ProfileSearchHit): ProfileSearchHit {
  const keep = (next: number | null | undefined, prev: number | null | undefined) =>
    typeof next === 'number' ? next : (prev ?? next);
  return {
    ...base,
    ...hit,
    metadata: { ...base.metadata, ...hit.metadata },
    rank: keep(hit.rank, base.rank),
    score: keep(hit.score, base.score),
    followers: keep(hit.followers, base.followers),
    follows: keep(hit.follows, base.follows),
  };
}

/**
 * Union of review events by id (deduped per reviewer), count never below what
 * any source reported, and the best-ranked non-null average wins (nagg's
 * server-side aggregate is authoritative when present).
 */
function mergeMintReviews(): (
  acc: MintReviewsSummary | undefined,
  next: MintReviewsSummary,
  tier: NostrTier,
) => MintReviewsSummary {
  let averageOwner: number | null = null;
  return (acc, next, tier) => {
    const rank = tierRank(tier);
    if (!acc) {
      averageOwner = next.averageScore === null ? null : rank;
      return { ...next, reviews: [...next.reviews] };
    }
    const seen = new Set(acc.reviews.map((r) => r.eventId));
    const reviews: MintReview[] = dedupeByReviewer([
      ...acc.reviews,
      ...next.reviews.filter((r) => !seen.has(r.eventId)),
    ]);
    let averageScore = acc.averageScore;
    if (next.averageScore !== null && (averageOwner === null || rank < averageOwner)) {
      averageScore = next.averageScore;
      averageOwner = rank;
    }
    return {
      mintUrl: acc.mintUrl,
      averageScore,
      reviewCount: Math.max(acc.reviewCount, next.reviewCount, reviews.length),
      reviews,
    };
  };
}

/** The newest kind-3 wins the follows/relays/mutes (rank breaks ties); profiles union. */
function mergeSocialGraph(acc: SocialGraph | undefined, next: SocialGraph, tier: NostrTier): SocialGraph {
  if (!acc) {
    const first: SocialGraph = { ...next, profiles: { ...next.profiles } };
    rankOwners.set(first, tier);
    return first;
  }
  const accTier = rankOwner(acc);
  const nextWins =
    next.contactsUpdatedAt > acc.contactsUpdatedAt ||
    (next.contactsUpdatedAt === acc.contactsUpdatedAt && tierRank(tier) < tierRank(accTier));
  const base = nextWins ? next : acc;
  const merged: SocialGraph = {
    pubkey: base.pubkey,
    follows: [...base.follows],
    relayList: [...base.relayList],
    mutes: [...base.mutes],
    contactsUpdatedAt: base.contactsUpdatedAt,
    profiles: { ...next.profiles, ...acc.profiles, ...(nextWins ? next.profiles : {}) },
  };
  rankOwners.set(merged, nextWins ? tier : accTier);
  return merged;
}

function short(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

/** Strip a cached profile down to the contract `ProfileMetadata` (drop pubkey/seenAt/srcRank). */
function metadataOf(cached: CachedProfile): ProfileMetadata {
  const { pubkey: _pubkey, seenAt: _seenAt, srcRank: _srcRank, ...metadata } = cached;
  return metadata;
}

function metadataMapOf(cached: Record<string, CachedProfile>): Record<string, ProfileMetadata> {
  const out: Record<string, ProfileMetadata> = {};
  for (const [pubkey, profile] of Object.entries(cached)) out[pubkey] = metadataOf(profile);
  return out;
}

/** Build the ordered candidate list from strategies that implement a surface. */
function candidatesFor<T>(
  tiers: ReadonlyArray<NostrTierStrategy>,
  surface: keyof NostrTierStrategy,
  attempt: (tier: NostrTierStrategy) => TierCandidate<T>['attempt'],
): TierCandidate<T>[] {
  return tiers
    .filter((tier) => typeof tier[surface] === 'function')
    .map((tier) => ({ tier: tier.tier, attempt: attempt(tier) }));
}
