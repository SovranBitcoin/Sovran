import type { Result } from 'neverthrow';
import type { NostrTier } from '@sovranbitcoin/schemas';
import {
  resolveAcrossTiers,
  applyOrderingManifest,
  type TierCandidate,
  type TierResolutionError,
} from '../tiers';
import type { FeedBundle, FeedPageRequest, ResolvedFeedPage } from './feed';
import type { ThreadBundle, ThreadRequest, ResolvedThread } from './thread';
import type {
  NotificationsBundle,
  NotificationsRequest,
  ResolvedNotifications,
} from './notifications';
import type { OwnHistoryBundle, OwnHistoryRequest, ResolvedOwnHistory } from './own-state';
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
}

export function createNostrDataLayer(config: NostrDataLayerConfig): NostrDataLayer {
  return {
    async getFeedPage(request) {
      const candidates = candidatesFor(config.tiers, 'feedPage', (tier) => () => tier.feedPage!(request));
      const resolved = await resolveAcrossTiers<FeedBundle>(candidates);
      return resolved.map(({ tier, value }) => assembleFeedPage(tier, value));
    },

    async getThread(request) {
      const candidates = candidatesFor(config.tiers, 'thread', (tier) => () => tier.thread!(request));
      const resolved = await resolveAcrossTiers<ThreadBundle>(candidates);
      return resolved.map(({ tier, value }) => assembleThread(tier, value));
    },

    async getNotifications(request) {
      const candidates = candidatesFor(
        config.tiers,
        'notifications',
        (tier) => () => tier.notifications!(request),
      );
      const resolved = await resolveAcrossTiers<NotificationsBundle>(candidates);
      return resolved.map(({ tier, value }) => assembleNotifications(tier, value));
    },

    async getOwnHistory(request) {
      const candidates = candidatesFor(
        config.tiers,
        'ownHistory',
        (tier) => () => tier.ownHistory!(request),
      );
      const resolved = await resolveAcrossTiers<OwnHistoryBundle>(candidates);
      return resolved.map(({ tier, value }) => assembleOwnHistory(tier, request.actionType, value));
    },
  };
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
