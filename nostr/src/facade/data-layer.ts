import { createFeedPager, type FeedPager, type FeedPagerOptions } from './feed-pager';
import type { NotificationSortKey } from "./notifications";
import { ok, err, type Result } from 'neverthrow';
import type { NostrTier } from '@sovranbitcoin/schemas';
import {
  resolveAcrossTiers,
  resolveAllTiers,
  auditAcrossTiers,
  applyOrderingManifest,
  type ReadProvenance,
  type TierAggregate,
  type TierCandidate,
  type TierReadContext,
  type TierResolutionError,
} from '../tiers';
import { nostrLog, type NostrLogData } from '../log';
import type { RequestControls } from '../timeout';
import type { NaggFeedEvent } from '../map/feed';
import {
  assembleFeedPage, type FeedBundle, type FeedItem, type FeedPageRequest, type ResolvedFeedPage } from './feed';
import {
  partitionOpFirst,
  isDirectReplyTo,
  type ThreadBundle,
  type ThreadRequest,
  type ThreadSort,
  type ThreadAuditRequest,
  type ResolvedThread,
  type ResolvedThreadAudit,
} from './thread';
import type {
  NotificationItem,
  NotificationsBundle,
  NotificationsRequest,
  ResolvedNotifications,
} from './notifications';
import {
  createNotificationsSession,
  type NotificationsSession,
} from './session/notifications-session';
import type { OwnHistoryBundle, OwnHistoryRequest, ResolvedOwnHistory } from './own-state';
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
import type { NoteStatsRequest, ResolvedNoteStats } from './note-stats';
import type { NoteStatsMap } from '@sovranbitcoin/schemas';
import type { NostrTierStrategy } from './strategy';
import {
  createNostrEntityCache,
  type NostrEntityCache,
  type EntityCacheLimits,
  type CachedProfile,
} from './cache/entity-cache';
import { readThread as readThreadFromCache, type CachedThreadView } from './cache/read-thread';
import {
  ingestFeedPage,
  ingestThread,
  ingestNotifications,
  ingestSocialGraph,
  ingestProfiles,
  ingestProfileStats,
} from './cache/ingest';

// ---------------------------------------------------------------------------
// NostrDataLayer — the opinionated facade
//
// The single entry point for Nostr reads, expressed in domain terms. It owns
// tier selection (the fallback engine) and ordering (the manifest applier);
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
  /**
   * Synchronous first-frame projection of a thread from the cache alone: the
   * tapped note + its cached ancestor chain + author profiles/metrics, with no
   * network. A binding renders this immediately, then awaits `getThread` for the
   * ranked reply delta. Returns `root: undefined` when the note isn't cached.
   */
  readThread(noteId: string): CachedThreadView;
  createFeedPager(request: Omit<FeedPagerOptions, 'tiers' | 'ingest'>): FeedPager;
  getFeedPage(request: FeedPageRequest): Promise<Result<ResolvedFeedPage, TierResolutionError>>;
  getThread(request: ThreadRequest): Promise<Result<ResolvedThread, TierResolutionError>>;
  /**
   * Background "Might be spam" second opinion for a thread: consult only the
   * tiers BELOW the one that served the primary read, diff their direct
   * replies against the primary's acknowledged set, and return the extras
   * (OP-authored ones split out for promotion). Memoized per note (~5 min) so
   * navigation churn doesn't re-run the Primal/relay fan-out. Never throws;
   * exhaustion is `{ tier: null }`.
   */
  auditThreadReplies(request: ThreadAuditRequest): Promise<ResolvedThreadAudit>;
  getNotifications(
    request: NotificationsRequest,
  ): Promise<Result<ResolvedNotifications, TierResolutionError>>;
  /**
   * The CONCURRENT notifications surface: every tier that implements
   * `notifications` is opened at once and merged into one shift-free page
   * stream (see createNotificationsSession). nagg may lack history, so
   * redundancy — not "best tier that works" — is the point here; this is the
   * one surface that deliberately fans out instead of using the sequential
   * engine. `getNotifications` above stays the one-shot waterfall (used by the
   * followers detail screen and any grouped:false consumer).
   */
  openNotificationsSession(request: NotificationsRequest): NotificationsSession;
  getOwnHistory(
    request: OwnHistoryRequest,
  ): Promise<Result<ResolvedOwnHistory, TierResolutionError>>;
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
  /**
   * Per-note engagement counts for ids a page did not carry. Aggregate: nagg
   * and the relay floor are asked at once, the first answer resolves, later
   * ones merge into the entity cache under their own rank. Ids are marked
   * pending until every tier settled (placeholder vs unknown, for bindings).
   */
  getNoteStats(request: NoteStatsRequest): Promise<Result<ResolvedNoteStats, TierResolutionError>>;
}

export function createNostrDataLayer(config: NostrDataLayerConfig): NostrDataLayer {
  const tierNames = config.tiers.map((t) => t.tier);
  nostrLog.info('nostr.facade.created', { tiers: tierNames });
  const cache = config.cache ?? createNostrEntityCache(config.cacheLimits);

  const dmLiveTier = config.tiers.find((t) => typeof t.dmLiveSubscribe === 'function');

  // Per-note audit memo. Layer-scoped (the app supplies a profile-scoped
  // layer singleton, so a profile switch drops it with everything else).
  const auditMemo: ThreadAuditMemo = new Map();

  return {
    cache,

    readThread(noteId) {
      return readThreadFromCache(cache, noteId);
    },

    createFeedPager(request) {
      return createFeedPager({
        ...request,
        tiers: config.tiers,
        ingest: (page) => ingestFeedPage(cache, page),
      });
    },

    async getFeedPage(request) {
      return runRead(
        'feed',
        request,
        { spec: request.spec.kind, limit: request.limit ?? null, paged: !!request.cursor },
        async (ctx) => {
          const candidates = candidatesFor(config.tiers, 'feedPage', (t) => () => t.feedPage!(request));
          return (await resolveAcrossTiers<FeedBundle>(candidates, ctx)).map(({ tier, value }) => {
            const page = assembleFeedPage(tier, value);
            ingestFeedPage(cache, page);
            return page;
          });
        },
        (p) => ({ items: p.items.length, missingIds: p.missingIds.length, hasActions: !!p.actions }),
      );
    },

    async getThread(request) {
      const sort: ThreadSort = request.sort ?? 'relevant';
      return runRead(
        'thread',
        request,
        { noteId: short(request.noteId), sort, offset: request.offset ?? 0 },
        async (ctx) => {
          const candidates = candidatesFor(config.tiers, 'thread', (t) => () => t.thread!(request));
          return (await resolveAcrossTiers<ThreadBundle>(candidates, ctx)).map(({ tier, value }) => {
            const thread = assembleThread(tier, value, sort);
            ingestThread(cache, thread);
            return thread;
          });
        },
        (t) => ({
          replies: t.replies.length,
          extras: t.extras.length,
          hasMore: t.hasMore,
          missingIds: t.missingIds.length,
        }),
      );
    },

    async auditThreadReplies(request) {
      return auditThread(config.tiers, cache, auditMemo, request);
    },

    openNotificationsSession(request) {
      const sources = config.tiers
        .filter((t) => typeof t.notifications === 'function')
        .map((t) => ({
          tier: t.tier,
          fetch: (req: NotificationsRequest) => t.notifications!(req),
        }));
      const notifLiveTier = config.tiers.find(
        (t) => typeof t.notificationsLiveSubscribe === 'function',
      );
      return createNotificationsSession({
        request,
        readId: request.readId ?? mintReadId('notifications'),
        sources,
        cache,
        ...(notifLiveTier
          ? {
              liveSubscribe: (
                req: NotificationsRequest,
                since: NotificationSortKey | undefined,
                onItems: (items: readonly NotificationItem[]) => void,
              ) => notifLiveTier.notificationsLiveSubscribe!(req, since, onItems),
            }
          : {}),
        ...(request.limit ? { pageSize: request.limit } : {}),
      });
    },

    async getNotifications(request) {
      return runRead(
        'notifications',
        request,
        { tab: request.tab ?? 'ALL', grouped: request.grouped !== false, paged: !!request.cursor },
        async (ctx) => {
          const candidates = candidatesFor(config.tiers, 'notifications', (t) => () => t.notifications!(request));
          return (await resolveAcrossTiers<NotificationsBundle>(candidates, ctx)).map(({ tier, value }) => {
            const notifs = assembleNotifications(tier, value);
            ingestNotifications(cache, notifs);
            return notifs;
          });
        },
        (n) => ({ notifications: n.notifications.length, grouped: n.grouped }),
      );
    },

    async getOwnHistory(request) {
      return runRead(
        'ownHistory',
        request,
        { actionType: request.actionType, paged: !!request.cursor },
        async (ctx) => {
          const candidates = candidatesFor(config.tiers, 'ownHistory', (t) => () => t.ownHistory!(request));
          return (await resolveAcrossTiers<OwnHistoryBundle>(candidates, ctx)).map(({ tier, value }) =>
            assembleOwnHistory(tier, request.actionType, value),
          );
        },
        (h) => ({ entries: h.entries.length }),
      );
    },

    async getMintReviews(request) {
      return runRead(
        'mintReviews',
        request,
        { mintUrl: request.mintUrl },
        async (ctx) => {
          const candidates = candidatesFor<MintReviewsSummary>(config.tiers, 'getMintReviews', (t) => () => t.getMintReviews!(request));
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
              merge: mergeMintReviews(),
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
          return (await resolveAcrossTiers<DmEnvelopesBundle>(candidates, ctx)).map(({ tier, value }) => ({ tier, envelopes: value.envelopes, cursor: value.cursor }));
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
              // Cache each answer under ITS tier's rank (srcRank merge keeps the best fields).
              ingestProfiles(cache, { tier, profiles: next.profiles });
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
          joinedAt: r.joinedAt ?? null,
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
          const resolvedOf = (agg: TierAggregate<ProfileSearchBundle>): ResolvedProfileSearch => ({
            tier: agg.tier,
            ...agg.value,
            provenance: provenanceOf(ctx.readId, agg),
          });
          return (
            await resolveAllTiers<ProfileSearchBundle>(candidates, {
              ...ctx,
              gate: { minItems: 1, capMs: AGGREGATE_CAP_MS.searchProfiles },
              count: (bundle) => bundle.hits.length,
              merge: mergeSearchBundles(),
              onUpdate: (agg) => request.onUpdate?.(resolvedOf(agg)),
            })
          ).map(resolvedOf);
        },
        (r) => ({ hits: r.hits.length, ...describeProvenance(r.provenance) }),
      );
    },

    async getNoteStats(request) {
      return runRead(
        'noteStats',
        request,
        { ids: request.ids.length },
        async (ctx) => {
          const ids = [...new Set(request.ids)];
          if (ids.length === 0) {
            return ok<ResolvedNoteStats, TierResolutionError>({ tier: 'cache', stats: {} });
          }
          cache.pendingNoteStats.begin(ids);
          const candidates = candidatesFor<NoteStatsMap>(config.tiers, 'getNoteStats', (t) => () => t.getNoteStats!({ ...request, ids }));
          const resolvedOf = (agg: TierAggregate<NoteStatsMap>): ResolvedNoteStats => ({
            tier: agg.tier,
            stats: agg.value,
            provenance: provenanceOf(ctx.readId, agg),
          });
          const first = await resolveAllTiers<NoteStatsMap>(candidates, {
            ...ctx,
            gate: { minItems: 1, capMs: AGGREGATE_CAP_MS.noteStats },
            count: (stats) => Object.keys(stats).length,
            merge: (acc, next, tier) => {
              // Each answer lands in the cache under ITS rank (a relay lower
              // bound never overwrites nagg's aggregate).
              cache.ingestNoteStats(next, tier);
              return mergeNoteStatsByRank(acc, next, tier);
            },
            onUpdate: (agg) => {
              if (agg.complete) cache.pendingNoteStats.end(ids);
            },
          });
          if (first.isErr()) {
            cache.pendingNoteStats.end(ids);
            return err(first.error);
          }
          if (first.value.complete) cache.pendingNoteStats.end(ids);
          return ok<ResolvedNoteStats, TierResolutionError>(resolvedOf(first.value));
        },
        (r) => ({ stats: Object.keys(r.stats).length, ...describeProvenance(r.provenance) }),
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
  noteStats: 800,
} as const;

const TIER_RANK_ORDER: readonly NostrTier[] = ['nagg', 'primal', 'relay', 'cache'];
function tierRank(tier: NostrTier): number {
  const index = TIER_RANK_ORDER.indexOf(tier);
  return index < 0 ? TIER_RANK_ORDER.length : index;
}

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

/** Union by pubkey; a better-ranked tier's metadata replaces a worse one's in place. */
function mergeProfileBundles(
  acc: ProfilesBundle | undefined,
  next: ProfilesBundle,
  tier: NostrTier,
): ProfilesBundle {
  if (!acc) return { profiles: { ...next.profiles } };
  const profiles = { ...acc.profiles };
  for (const [pubkey, metadata] of Object.entries(next.profiles)) {
    const existing = profiles[pubkey];
    if (!existing || tierRank(tier) <= tierRank(rankOwner(existing))) {
      profiles[pubkey] = metadata;
      rankOwners.set(metadata, tier);
    }
  }
  return { profiles };
}
// Which tier supplied a metadata object, so a later worse-ranked answer cannot
// overwrite it. Keyed weakly on the object itself: no ids, no leaks.
const rankOwners = new WeakMap<object, NostrTier>();
function rankOwner(metadata: object): NostrTier {
  return rankOwners.get(metadata) ?? 'relay';
}

/** Union by note id; a better-ranked tier's counts replace a worse one's, a worse one only adds ids. */
function mergeNoteStatsByRank(
  acc: NoteStatsMap | undefined,
  next: NoteStatsMap,
  tier: NostrTier,
): NoteStatsMap {
  if (!acc) {
    rankOwners.set(next, tier);
    return { ...next };
  }
  const accTier = rankOwner(acc);
  const nextWins = tierRank(tier) <= tierRank(accTier);
  const merged: NoteStatsMap = nextWins ? { ...acc, ...next } : { ...next, ...acc };
  rankOwners.set(merged, nextWins ? tier : accTier);
  return merged;
}

/** Fill only the fields the earlier answers left undefined; never overwrite a number with undefined. */
function mergeProfileStats(acc: ProfileStats | undefined, next: ProfileStats): ProfileStats {
  if (!acc) return { ...next };
  return {
    pubkey: acc.pubkey,
    metadata: acc.metadata ?? next.metadata,
    followersCount: acc.followersCount ?? next.followersCount,
    followingCount: acc.followingCount ?? next.followingCount,
    noteCount: acc.noteCount ?? next.noteCount,
    joinedAt: acc.joinedAt ?? next.joinedAt,
  };
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
        hits[at] = { ...hits[at]!, ...hit, metadata: { ...hits[at]!.metadata, ...hit.metadata } };
      }
    }
    return {
      hits,
      vertexFresh: upgrades ? (next.vertexFresh ?? acc.vertexFresh ?? null) : (acc.vertexFresh ?? next.vertexFresh ?? null),
    };
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
    rankOwners.set(next, tier);
    return { ...next, profiles: { ...next.profiles } };
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

const THREAD_AUDIT_TTL_MS = 5 * 60_000;
const THREAD_AUDIT_MEMO_MAX = 50;

type ThreadAuditMemo = Map<string, { at: number; promise: Promise<ResolvedThreadAudit> }>;

const EMPTY_THREAD_AUDIT: ResolvedThreadAudit = {
  tier: null,
  extras: [],
  opExtras: [],
  stats: {},
  profiles: {},
};

function auditThread(
  tiers: ReadonlyArray<NostrTierStrategy>,
  cache: NostrEntityCache,
  memo: ThreadAuditMemo,
  request: ThreadAuditRequest,
): Promise<ResolvedThreadAudit> {
  const cached = memo.get(request.noteId);
  const now = Date.now();
  if (cached && now - cached.at < THREAD_AUDIT_TTL_MS) {
    nostrLog.debug('nostr.read.threadAudit.memo', { noteId: short(request.noteId) });
    return cached.promise;
  }
  const promise = runThreadAudit(tiers, cache, request);
  memo.set(request.noteId, { at: now, promise });
  if (memo.size > THREAD_AUDIT_MEMO_MAX) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  return promise;
}

async function runThreadAudit(
  tiers: ReadonlyArray<NostrTierStrategy>,
  cache: NostrEntityCache,
  request: ThreadAuditRequest,
): Promise<ResolvedThreadAudit> {
  const primaryIndex = tiers.findIndex((t) => t.tier === request.primaryTier);
  const below =
    primaryIndex < 0 ? [] : tiers.slice(primaryIndex + 1).filter((t) => typeof t.thread === 'function');
  if (below.length === 0) {
    nostrLog.debug('nostr.read.threadAudit.skipped', {
      reason: 'no_lower_tiers',
      primary: request.primaryTier,
    });
    return EMPTY_THREAD_AUDIT;
  }

  const readId = request.readId ?? mintReadId('threadAudit');
  nostrLog.info('nostr.read.threadAudit.request', {
    readId,
    noteId: short(request.noteId),
    primary: request.primaryTier,
    tiers: below.map((t) => t.tier),
    known: request.knownReplyIds.length,
  });

  // Single shot, no retry: the audit can only ADD to an already-rendered
  // thread, so failure is silent by design.
  const auditRequest: ThreadRequest = {
    noteId: request.noteId,
    limit: 100,
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
  };
  const answer = await auditAcrossTiers<ThreadBundle>(
    below.map((t) => ({ tier: t.tier, attempt: () => t.thread!(auditRequest) })),
    { readId, surface: 'threadAudit' },
  );
  if (!answer) {
    nostrLog.info('nostr.read.threadAudit.done', {
      readId,
      noteId: short(request.noteId),
      tier: null,
      extras: 0,
    });
    return EMPTY_THREAD_AUDIT;
  }

  const { tier, value: bundle } = answer;
  const known = new Set(request.knownReplyIds);
  const excluded = new Set<string>([request.noteId]);
  for (const parent of bundle.parents) {
    if (parent.type === 'note') excluded.add(parent.event.id);
  }

  const opExtras: FeedItem[] = [];
  const extras: FeedItem[] = [];
  for (const item of bundle.itemsById.values()) {
    if (item.type !== 'note') continue;
    const event = item.event;
    if (known.has(event.id) || excluded.has(event.id)) continue;
    if (!isDirectReplyTo(event, request.noteId)) continue;
    (event.pubkey === request.opPubkey ? opExtras : extras).push(item);
  }
  // OP promotions read as the author's continuation → chronological; the spam
  // bucket reads as an appendix → recency-descending, id tiebreak.
  const createdAtOf = (item: FeedItem) =>
    item.type === 'note' ? item.event.created_at : 0;
  const idOf = (item: FeedItem) => (item.type === 'note' ? item.event.id : '');
  opExtras.sort((a, b) => createdAtOf(a) - createdAtOf(b) || (idOf(a) < idOf(b) ? -1 : 1));
  extras.sort((a, b) => createdAtOf(b) - createdAtOf(a) || (idOf(a) > idOf(b) ? -1 : 1));

  // Cache the findings (notes + profiles + stats) so tapping one opens instantly.
  const events: NaggFeedEvent[] = [];
  for (const item of [...opExtras, ...extras]) {
    if (item.type === 'note') events.push(item.event);
  }
  cache.ingestNotes(events);
  cache.ingestNoteStats(bundle.stats, tier);
  cache.ingestProfileInfos(bundle.profiles, tier);

  nostrLog.info('nostr.read.threadAudit.done', {
    readId,
    noteId: short(request.noteId),
    tier,
    extras: extras.length,
    opExtras: opExtras.length,
  });
  return { tier, extras, opExtras, stats: bundle.stats, profiles: bundle.profiles };
}

function assembleThread(tier: NostrTier, bundle: ThreadBundle, sort: ThreadSort): ResolvedThread {
  const missingIds: string[] = [];
  const ordered = applyOrderingManifest(bundle.manifest, bundle.itemsById, {
    onMissing: (id) => missingIds.push(id),
  });
  // The relevant sort pins the OP's DIRECT replies first across EVERY tier.
  // Stable partition only, and only over direct replies: nagg's server order
  // already leads with the OP block (no-op there), and the OP's nested replies
  // to other commenters must stay where the sort put them — on any page.
  const opPubkey = bundle.root.type === 'note' ? bundle.root.event.pubkey : undefined;
  const rootId = bundle.root.type === 'note' ? bundle.root.event.id : undefined;
  const replies =
    sort === 'relevant' && opPubkey && rootId
      ? partitionOpFirst(ordered, opPubkey, (item) =>
          item.type === 'note' && isDirectReplyTo(item.event, rootId)
            ? item.event.pubkey
            : undefined,
        )
      : ordered;
  const knownReplyIds = [
    ...new Set([
      ...bundle.manifest.elements,
      ...bundle.extras.map((item) => (item.type === 'note' ? item.event.id : '')).filter(Boolean),
    ]),
  ];
  return {
    tier,
    root: bundle.root,
    parents: bundle.parents,
    replies,
    extras: bundle.extras,
    hasMore: bundle.hasMore,
    ...(bundle.nextOffset !== undefined ? { nextOffset: bundle.nextOffset } : {}),
    knownReplyIds,
    stats: bundle.stats,
    ...(bundle.actions ? { actions: bundle.actions } : {}),
    profiles: bundle.profiles,
    quoted: bundle.quoted,
    cursor: bundle.cursor,
    missingIds,
  };
}

function assembleOwnHistory(
  tier: NostrTier,
  actionType: ResolvedOwnHistory['actionType'],
  bundle: OwnHistoryBundle,
): ResolvedOwnHistory {
  const missingIds: string[] = [];
  const entries = applyOrderingManifest(bundle.manifest, bundle.itemsById, {
    onMissing: (id) => missingIds.push(id),
  });
  return { tier, actionType, entries, cursor: bundle.cursor, missingIds };
}

function assembleNotifications(tier: NostrTier, bundle: NotificationsBundle): ResolvedNotifications {
  const missingIds: string[] = [];
  const notifications = applyOrderingManifest(bundle.manifest, bundle.itemsById, {
    onMissing: (id) => missingIds.push(id),
  });
  return {
    tier,
    notifications,
    grouped: bundle.grouped,
    stats: bundle.stats,
    profiles: bundle.profiles,
    quoted: bundle.quoted,
    cursor: bundle.cursor,
    missingIds,
  };
}
