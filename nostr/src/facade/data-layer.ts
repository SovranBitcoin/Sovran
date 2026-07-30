import { ok, type Result } from 'neverthrow';
import type { NostrTier } from '@sovranbitcoin/schemas';
import {
  resolveAcrossTiers,
  auditAcrossTiers,
  applyOrderingManifest,
  type TierCandidate,
  type TierResolutionError,
} from '../tiers';
import { nostrLog, type NostrLogData } from '../log';
import type { NaggFeedEvent } from '../map/feed';
import { feedItemKey, type FeedBundle, type FeedItem, type FeedPageRequest, type ResolvedFeedPage } from './feed';
import {
  createSurfaceSession,
  type FetchPage,
  type LiveSubscribe,
  type SurfaceSession,
} from './session/surface-session';
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
import type { SortKey } from './session/page-buffer';
import type { OwnHistoryBundle, OwnHistoryRequest, ResolvedOwnHistory } from './own-state';
import type {
  DiscoverMintsRequest,
  DiscoveredMint,
  MintReviewsRequest,
  MintReviewsSummary,
  ResolvedDiscoveredMints,
  ResolvedMintReviews,
} from './mint-reviews';
import type { SocialGraph, SocialGraphRequest, ResolvedSocialGraph } from './social-graph';
import type { DmEnvelope, DmEnvelopesBundle, DmEnvelopesRequest, ResolvedDmEnvelopes } from './dm';
import type { ProfileMetadata, ProfilesBundle, ProfilesRequest, ResolvedProfiles } from './profiles';
import {
  profileStatsIsEmpty,
  type ProfileStatsBundle,
  type ProfileStatsRequest,
  type ResolvedProfileStats,
} from './profile-stats';
import type { ProfileSearchBundle, SearchRequest, ResolvedProfileSearch } from './search';
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
  getFeedPage(request: FeedPageRequest): Promise<Result<ResolvedFeedPage, TierResolutionError>>;
  /**
   * A live-aware feed SESSION: a normal paginated API (firstPage/loadOlder/
   * loadNew) over the tiered fetch, with a relay-only background listener feeding
   * the "Load new" pill. Pages still fall back across tiers; only the live delta
   * is relay-only. The app drives this instead of getFeedPage for scrollable feeds.
   */
  openFeedSession(request: FeedPageRequest): SurfaceSession<FeedItem>;
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
}

export function createNostrDataLayer(config: NostrDataLayerConfig): NostrDataLayer {
  const tierNames = config.tiers.map((t) => t.tier);
  nostrLog.info('nostr.facade.created', { tiers: tierNames });
  const cache = config.cache ?? createNostrEntityCache(config.cacheLimits);

  // The relay tier (if configured) owns the live "Load new" listener — the one
  // explicit relay seam. Pages come from whichever tier answers; the delta is
  // relay-only.
  const liveTier = config.tiers.find((t) => typeof t.feedLiveSubscribe === 'function');
  const dmLiveTier = config.tiers.find((t) => typeof t.dmLiveSubscribe === 'function');

  // Per-note audit memo. Layer-scoped (the app supplies a profile-scoped
  // layer singleton, so a profile switch drops it with everything else).
  const auditMemo: ThreadAuditMemo = new Map();

  return {
    cache,

    readThread(noteId) {
      return readThreadFromCache(cache, noteId);
    },

    openFeedSession(request) {
      const fetchPage: FetchPage<FeedItem> = async (bound) => {
        const pageRequest: FeedPageRequest = {
          ...request,
          cursor: bound.until ? { createdAt: bound.until.createdAt, id: bound.until.id } : request.cursor,
          limit: bound.limit,
        };
        const candidates = candidatesFor(config.tiers, 'feedPage', (t) => () => t.feedPage!(pageRequest));
        const resolved = await resolveAcrossTiers<FeedBundle>(candidates);
        return resolved.match(
          ({ tier, value }) => {
            const page = assembleFeedPage(tier, value);
            ingestFeedPage(cache, page);
            return page.items;
          },
          () => [],
        );
      };
      const liveSubscribe: LiveSubscribe<FeedItem> | undefined = liveTier
        ? (since, onItems) => liveTier.feedLiveSubscribe!(request, since, onItems)
        : undefined;
      return createSurfaceSession<FeedItem>({
        keyOf: feedItemKey,
        fetchPage,
        liveSubscribe,
        ...(request.limit ? { pageSize: request.limit } : {}),
      });
    },

    async getFeedPage(request) {
      return runRead(
        'feed',
        { spec: request.spec.kind, limit: request.limit ?? null, paged: !!request.cursor },
        async () => {
          const candidates = candidatesFor(config.tiers, 'feedPage', (t) => () => t.feedPage!(request));
          return (await resolveAcrossTiers<FeedBundle>(candidates)).map(({ tier, value }) => {
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
        { noteId: short(request.noteId), sort, offset: request.offset ?? 0 },
        async () => {
          const candidates = candidatesFor(config.tiers, 'thread', (t) => () => t.thread!(request));
          return (await resolveAcrossTiers<ThreadBundle>(candidates)).map(({ tier, value }) => {
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
        sources,
        cache,
        ...(notifLiveTier
          ? {
              liveSubscribe: (
                req: NotificationsRequest,
                since: SortKey | undefined,
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
        { tab: request.tab ?? 'ALL', grouped: request.grouped !== false, paged: !!request.cursor },
        async () => {
          const candidates = candidatesFor(config.tiers, 'notifications', (t) => () => t.notifications!(request));
          return (await resolveAcrossTiers<NotificationsBundle>(candidates)).map(({ tier, value }) => {
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
        { actionType: request.actionType, paged: !!request.cursor },
        async () => {
          const candidates = candidatesFor(config.tiers, 'ownHistory', (t) => () => t.ownHistory!(request));
          return (await resolveAcrossTiers<OwnHistoryBundle>(candidates)).map(({ tier, value }) =>
            assembleOwnHistory(tier, request.actionType, value),
          );
        },
        (h) => ({ entries: h.entries.length }),
      );
    },

    async getMintReviews(request) {
      return runRead(
        'mintReviews',
        { mintUrl: request.mintUrl },
        async () => {
          const candidates = candidatesFor<MintReviewsSummary>(config.tiers, 'getMintReviews', (t) => () => t.getMintReviews!(request));
          return (await resolveAcrossTiers<MintReviewsSummary>(candidates)).map(({ tier, value }) => ({ tier, ...value }));
        },
        (r) => ({ reviewCount: r.reviewCount, averageScore: r.averageScore }),
      );
    },

    async discoverMints(request) {
      return runRead(
        'discoverMints',
        { limit: request.limit ?? null },
        async () => {
          const candidates = candidatesFor<DiscoveredMint[]>(config.tiers, 'discoverMints', (t) => () => t.discoverMints!(request));
          return (await resolveAcrossTiers<DiscoveredMint[]>(candidates)).map(({ tier, value }) => ({ tier, mints: value }));
        },
        (r) => ({ mints: r.mints.length }),
      );
    },

    async getSocialGraph(request) {
      return runRead(
        'socialGraph',
        { pubkey: short(request.pubkey) },
        async () => {
          const candidates = candidatesFor<SocialGraph>(config.tiers, 'getSocialGraph', (t) => () => t.getSocialGraph!(request));
          return (await resolveAcrossTiers<SocialGraph>(candidates)).map(({ tier, value }) => {
            const graph = { tier, ...value };
            ingestSocialGraph(cache, graph);
            return graph;
          });
        },
        (g) => ({ follows: g.follows.length, profiles: Object.keys(g.profiles).length, mutes: g.mutes.length }),
      );
    },

    async getDmEnvelopes(request) {
      return runRead(
        'dmEnvelopes',
        { viewer: short(request.viewerPubkey), paged: !!request.cursor },
        async () => {
          const candidates = candidatesFor<DmEnvelopesBundle>(config.tiers, 'getDmEnvelopes', (t) => () => t.getDmEnvelopes!(request));
          return (await resolveAcrossTiers<DmEnvelopesBundle>(candidates)).map(({ tier, value }) => ({ tier, envelopes: value.envelopes, cursor: value.cursor }));
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
        { pubkeys: request.pubkeys.length },
        async () => {
          // Cache-first: split into what we already hold vs what to fetch.
          const { profiles: cached, missing } = cache.readProfiles(request.pubkeys);
          const cachedMeta = metadataMapOf(cached);
          // Everything already cached → serve instantly, no network round-trip.
          if (missing.length === 0 && !request.refresh) {
            return ok<ResolvedProfiles, TierResolutionError>({ tier: 'cache', profiles: cachedMeta });
          }
          // Otherwise fetch only the missing (or all, on refresh) and merge. Mark
          // those pubkeys pending so a binding shows a skeleton (not a fallback)
          // while they resolve; clear in `finally` so an error never strands them.
          const toFetch = request.refresh ? request.pubkeys : missing;
          const fetchReq = request.refresh ? request : { ...request, pubkeys: missing };
          cache.pendingProfiles.begin(toFetch);
          try {
            const candidates = candidatesFor<ProfilesBundle>(config.tiers, 'getProfiles', (t) => () => t.getProfiles!(fetchReq));
            return (await resolveAcrossTiers<ProfilesBundle>(candidates)).map(({ tier, value }) => {
              ingestProfiles(cache, { tier, profiles: value.profiles });
              return { tier, profiles: { ...cachedMeta, ...value.profiles } };
            });
          } finally {
            cache.pendingProfiles.end(toFetch);
          }
        },
        (r) => ({ profiles: Object.keys(r.profiles).length }),
      );
    },

    async getProfileStats(request) {
      return runRead(
        'profileStats',
        { pubkey: short(request.pubkey) },
        async () => {
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
          try {
            const candidates = candidatesFor<ProfileStatsBundle>(config.tiers, 'getProfileStats', (t) => () => t.getProfileStats!(request));
            return (await resolveAcrossTiers<ProfileStatsBundle>(candidates)).map(({ tier, value }) => {
              const resolved = { tier, ...value };
              ingestProfileStats(cache, resolved);
              return resolved;
            });
          } finally {
            cache.pendingProfiles.end([request.pubkey]);
          }
        },
        (r) => ({
          hasMetadata: !!r.metadata,
          followers: r.followersCount ?? null,
          following: r.followingCount ?? null,
          joinedAt: r.joinedAt ?? null,
        }),
      );
    },

    async searchProfiles(request) {
      return runRead(
        'searchProfiles',
        { q: request.query.length, limit: request.limit ?? null },
        async () => {
          const candidates = candidatesFor<ProfileSearchBundle>(config.tiers, 'searchProfiles', (t) => () => t.searchProfiles!(request));
          return (await resolveAcrossTiers<ProfileSearchBundle>(candidates)).map(({ tier, value }) => ({ tier, hits: value.hits }));
        },
        (r) => ({ hits: r.hits.length }),
      );
    },
  };
}

/** Log a read's request + outcome (answering tier + counts, or the exhaustion trail). */
async function runRead<R extends { tier: NostrTier }>(
  surface: string,
  summary: NostrLogData,
  run: () => Promise<Result<R, TierResolutionError>>,
  describe: (resolved: R) => NostrLogData,
): Promise<Result<R, TierResolutionError>> {
  nostrLog.info(`nostr.read.${surface}.request`, summary);
  const result = await run();
  result.match(
    (resolved) => nostrLog.info(`nostr.read.${surface}.done`, { tier: resolved.tier, ...describe(resolved) }),
    (error) =>
      nostrLog.warn(`nostr.read.${surface}.exhausted`, {
        attempts: error.attempts.map((a) => `${a.tier}=${a.outcome}`),
      }),
  );
  return result;
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

/** Apply the manifest to the unordered bundle — ordering happens in ONE place. */
function assembleFeedPage(tier: NostrTier, bundle: FeedBundle): ResolvedFeedPage {
  const missingIds: string[] = [];
  const items = applyOrderingManifest(bundle.manifest, bundle.itemsById, {
    onMissing: (id) => missingIds.push(id),
  });
  return {
    tier,
    items,
    stats: bundle.stats,
    ...(bundle.actions ? { actions: bundle.actions } : {}),
    profiles: bundle.profiles,
    quoted: bundle.quoted,
    cursor: bundle.cursor,
    missingIds,
  };
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

  nostrLog.info('nostr.read.threadAudit.request', {
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
  );
  if (!answer) {
    nostrLog.info('nostr.read.threadAudit.done', { noteId: short(request.noteId), tier: null, extras: 0 });
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
  const createdAtOf = (item: FeedItem) => (item.type === 'note' ? item.event.created_at : 0);
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
