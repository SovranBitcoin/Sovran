import type { NostrTier } from '@sovranbitcoin/schemas';
import { unsupported, type TierOutcome } from '../tiers';
import type { FeedBundle, FeedTier } from './feed';

// ---------------------------------------------------------------------------
// Not-yet-implemented tier placeholders
//
// The Primal WS client (tier 2) and the raw-relay adapter (tier 3) are built in
// follow-up steps. Until then they report `unsupported`, so the facade falls
// through to the next tier and the three-tier wiring stays HONEST — no silent
// gap, no pretending a tier exists. Swap these for the real adapters as they land.
// ---------------------------------------------------------------------------

export function pendingFeedTier(tier: NostrTier): FeedTier {
  return {
    tier,
    async feedPage(): Promise<TierOutcome<FeedBundle>> {
      return unsupported();
    },
  };
}
