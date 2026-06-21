import type { Result } from 'neverthrow';
import type { NostrTier } from '@sovranbitcoin/schemas';
import {
  resolveAcrossTiers,
  applyOrderingManifest,
  type TierCandidate,
  type TierResolutionError,
} from '../tiers';
import { nostrLog, type NostrLogData } from '../log';
import type { FeedBundle, FeedPageRequest, ResolvedFeedPage } from './feed';
import type { ThreadBundle, ThreadRequest, ResolvedThread } from './thread';
import type {
  NotificationsBundle,
  NotificationsRequest,
  ResolvedNotifications,
} from './notifications';
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
import type { DmEnvelopesBundle, DmEnvelopesRequest, ResolvedDmEnvelopes } from './dm';
import type { ProfilesBundle, ProfilesRequest, ResolvedProfiles } from './profiles';
import type { ProfileSearchBundle, SearchRequest, ResolvedProfileSearch } from './search';
import type { NostrTierStrategy } from './strategy';

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
};

export interface NostrDataLayer {
  getFeedPage(request: FeedPageRequest): Promise<Result<ResolvedFeedPage, TierResolutionError>>;
  getThread(request: ThreadRequest): Promise<Result<ResolvedThread, TierResolutionError>>;
  getNotifications(
    request: NotificationsRequest,
  ): Promise<Result<ResolvedNotifications, TierResolutionError>>;
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
  getProfiles(request: ProfilesRequest): Promise<Result<ResolvedProfiles, TierResolutionError>>;
  searchProfiles(
    request: SearchRequest,
  ): Promise<Result<ResolvedProfileSearch, TierResolutionError>>;
}

export function createNostrDataLayer(config: NostrDataLayerConfig): NostrDataLayer {
  const tierNames = config.tiers.map((t) => t.tier);
  nostrLog.info('nostr.facade.created', { tiers: tierNames });

  return {
    async getFeedPage(request) {
      return runRead(
        'feed',
        { spec: request.spec.kind, limit: request.limit ?? null, paged: !!request.cursor },
        async () => {
          const candidates = candidatesFor(config.tiers, 'feedPage', (t) => () => t.feedPage!(request));
          return (await resolveAcrossTiers<FeedBundle>(candidates)).map(({ tier, value }) =>
            assembleFeedPage(tier, value),
          );
        },
        (p) => ({ items: p.items.length, missingIds: p.missingIds.length, hasActions: !!p.actions }),
      );
    },

    async getThread(request) {
      return runRead(
        'thread',
        { noteId: short(request.noteId), sort: request.sort ?? 'relevant' },
        async () => {
          const candidates = candidatesFor(config.tiers, 'thread', (t) => () => t.thread!(request));
          return (await resolveAcrossTiers<ThreadBundle>(candidates)).map(({ tier, value }) =>
            assembleThread(tier, value),
          );
        },
        (t) => ({ replies: t.replies.length, missingIds: t.missingIds.length }),
      );
    },

    async getNotifications(request) {
      return runRead(
        'notifications',
        { tab: request.tab ?? 'ALL', grouped: request.grouped !== false, paged: !!request.cursor },
        async () => {
          const candidates = candidatesFor(config.tiers, 'notifications', (t) => () => t.notifications!(request));
          return (await resolveAcrossTiers<NotificationsBundle>(candidates)).map(({ tier, value }) =>
            assembleNotifications(tier, value),
          );
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
          return (await resolveAcrossTiers<SocialGraph>(candidates)).map(({ tier, value }) => ({ tier, ...value }));
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

    async getProfiles(request) {
      return runRead(
        'profiles',
        { pubkeys: request.pubkeys.length },
        async () => {
          const candidates = candidatesFor<ProfilesBundle>(config.tiers, 'getProfiles', (t) => () => t.getProfiles!(request));
          return (await resolveAcrossTiers<ProfilesBundle>(candidates)).map(({ tier, value }) => ({ tier, profiles: value.profiles }));
        },
        (r) => ({ profiles: Object.keys(r.profiles).length }),
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

function assembleThread(tier: NostrTier, bundle: ThreadBundle): ResolvedThread {
  const missingIds: string[] = [];
  const replies = applyOrderingManifest(bundle.manifest, bundle.itemsById, {
    onMissing: (id) => missingIds.push(id),
  });
  return {
    tier,
    root: bundle.root,
    replies,
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
