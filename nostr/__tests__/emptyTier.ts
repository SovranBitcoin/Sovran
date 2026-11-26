import type { NostrTier } from '@sovranbitcoin/schemas';
import type { NostrTierStrategy } from '../src/facade';

/**
 * A tier that implements no surface: the fixture for "this tier cannot serve
 * the read, fall through".
 */
export function emptyTier(tier: NostrTier): NostrTierStrategy {
  return { tier };
}
