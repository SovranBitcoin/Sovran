import type { Result } from 'neverthrow';
import type { NostrTier } from '@sovranbitcoin/schemas';
import { resolveAcrossTiers, applyOrderingManifest, type TierResolutionError } from '../tiers';
import type { FeedBundle, FeedPageRequest, FeedTier, ResolvedFeedPage } from './feed';

// ---------------------------------------------------------------------------
// NostrDataLayer — the opinionated facade
//
// The single entry point for Nostr reads, expressed in domain terms. It owns
// tier selection (via the fallback engine) and ordering (via the manifest
// applier); callers never choose a tier or assemble events. Surfaces are wired
// in one at a time — feed first — each composing the same two primitives.
// ---------------------------------------------------------------------------

export type NostrDataLayerConfig = {
  /** Tiers tried in order for the feed surface. Conventionally [nagg, primal, relay]. */
  feedTiers: ReadonlyArray<FeedTier>;
};

export interface NostrDataLayer {
  getFeedPage(request: FeedPageRequest): Promise<Result<ResolvedFeedPage, TierResolutionError>>;
}

export function createNostrDataLayer(config: NostrDataLayerConfig): NostrDataLayer {
  return {
    async getFeedPage(request) {
      const candidates = config.feedTiers.map((tier) => ({
        tier: tier.tier,
        attempt: () => tier.feedPage(request),
      }));
      const resolved = await resolveAcrossTiers<FeedBundle>(candidates);
      return resolved.map(({ tier, value }) => assembleFeedPage(tier, value));
    },
  };
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
