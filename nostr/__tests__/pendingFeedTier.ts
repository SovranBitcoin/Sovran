import type { NostrTier } from '@sovranbitcoin/schemas';
import { unsupported, type TierOutcome } from '../src/tiers';
import type { FeedBundle, FeedTier } from '../src/facade';

/**
 * A tier that answers `unsupported` to a feed page and implements nothing
 * else: the fixture for "this tier cannot serve the read, fall through".
 */
export function pendingFeedTier(tier: NostrTier): FeedTier {
  return {
    tier,
    async feedPage(): Promise<TierOutcome<FeedBundle>> {
      return unsupported();
    },
  };
}
