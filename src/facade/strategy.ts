import type { NostrTier } from '@sovranbitcoin/schemas';
import type { TierOutcome } from '../tiers';
import type { FeedBundle, FeedPageRequest } from './feed';
import type { ThreadBundle, ThreadRequest } from './thread';
import type { NotificationsBundle, NotificationsRequest } from './notifications';

// ---------------------------------------------------------------------------
// Tier strategy — one deep module per source, implementing the surfaces it can
//
// A tier (nagg / Primal / relay) implements only the surface methods it can
// serve. The facade builds each read's tier list from the strategies that
// implement that surface: a strategy WITHOUT the method is skipped entirely
// ("this source doesn't do threads"); a strategy WITH the method that returns
// `unsupported` is recorded in the attempt trail ("does threads, not this one").
// This keeps wiring trivial — pass [nagg, primal, relay] once — and lets each
// surface grow independently.
// ---------------------------------------------------------------------------

export interface NostrTierStrategy {
  readonly tier: NostrTier;
  feedPage?(request: FeedPageRequest): Promise<TierOutcome<FeedBundle>>;
  thread?(request: ThreadRequest): Promise<TierOutcome<ThreadBundle>>;
  notifications?(request: NotificationsRequest): Promise<TierOutcome<NotificationsBundle>>;
}
