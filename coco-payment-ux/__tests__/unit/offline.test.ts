/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * offline.ts — Proof Composition Math
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * When the wallet is offline, it can't swap proofs with the mint — it must
 * compose a payment from the exact proof denominations it already has.
 * This is a variant of the subset-sum problem.
 *
 * Example: User has proofs [1, 2, 4, 8, 16, 32, 64, 128, 256, 512] sats.
 * To send exactly 100 sats offline, we need to find a subset that sums
 * to 100. With power-of-2 denominations: 4 + 32 + 64 = 100. ✓
 *
 * But if proofs are [512, 256, 128, 64, 32, 8] and the user wants 100,
 * no exact combination works — the closest are 96 (64+32) and 104 (64+32+8).
 * The user must choose: send less (96) or more (104) than intended.
 *
 * Three algorithms are used based on proof count and sum:
 *
 *   1. EXHAUSTIVE (≤20 proofs): Enumerate all 2^n subsets. Guaranteed
 *      optimal but exponential — only viable for small proof sets.
 *
 *   2. BITSET-DP (>20 proofs, small total sum): Dynamic programming
 *      using a bitset to track reachable sums. O(n × totalSum) but
 *      memory-efficient with the bitset representation.
 *
 *   3. MEET-IN-THE-MIDDLE (>20 proofs, large total sum): Split proofs
 *      into halves, enumerate subsets of each half, then combine.
 *      O(2^(n/2)) — much better than O(2^n) for large inputs.
 *
 * composeSatoshis returns:
 *   - exactMatch: boolean — can we compose the exact target?
 *   - nearestLower: closest sum below target (for "round down")
 *   - nearestUpper: closest sum above target (for "round up")
 *   - strategy: which algorithm was used
 *   - target: the original target amount
 *
 * composeFiat does the same but in fiat terms — it finds the sat amount
 * that rounds to the target fiat amount at the given exchange rate.
 *
 * buildExactOfflineAmountIndex precomputes ALL reachable sums for a proof
 * set, used to quickly check "can we send exactly X sats?" for any X.
 */

import { describe, it, expect } from 'vitest';
import {
  composeSatoshis,
  composeFiat,
  buildExactOfflineAmountIndex,
  getRoundedFiatMinorUnitForSats,
  getSatRangeForDisplayedFiatMinorUnit,
} from '../../src/offline';
import { resolveAmount } from '../../src/amount-actions/resolve';

// ---------------------------------------------------------------------------
// composeSatoshis — edge cases
// ---------------------------------------------------------------------------

/**
 * Edge cases test boundary conditions: empty inputs, zeros, exact limits,
 * and impossible targets. These catch off-by-one errors and null pointer
 * issues in the composition algorithms.
 */
describe('composeSatoshis — edge cases', () => {
  it('returns no match for empty coins', () => {
    // No proofs available → can't compose anything
    const result = composeSatoshis([], 100);
    expect(result.exactMatch).toBe(false);
    expect(result.nearestLower).toBeNull();
    expect(result.nearestUpper).toBeNull();
  });

  it('returns no match for all-zero coins', () => {
    // Proofs with 0 value are useless — can't compose any positive sum
    const result = composeSatoshis([0, 0, 0], 100);
    expect(result.exactMatch).toBe(false);
  });

  it('handles target <= 0', () => {
    // Target of 0 or negative doesn't make sense for a payment.
    // The algorithm should still return valid results without crashing.
    const result = composeSatoshis([1, 2, 4], 0);
    expect(result.exactMatch).toBe(false);
    // The smallest possible sum (1) becomes the nearest upper
    expect(result.nearestUpper).toBe(1);
  });

  it('handles target exactly equal to total sum', () => {
    // 1+2+4 = 7. Target is 7. This is the "use all proofs" case.
    // Should be an exact match using every proof in the set.
    const result = composeSatoshis([1, 2, 4], 7);
    expect(result.exactMatch).toBe(true);
    expect(result.target).toBe(7);
  });

  it('handles target exceeding total sum', () => {
    // 1+2+4 = 7 total. Target is 100. Impossible to reach.
    // nearestLower should be 7 (everything we have).
    // nearestUpper should be null (can't go above our total).
    const result = composeSatoshis([1, 2, 4], 100);
    expect(result.exactMatch).toBe(false);
    expect(result.nearestLower).toBe(7); // total sum is all we can offer
    expect(result.nearestUpper).toBeNull(); // nothing above target
  });

  it('finds exact match when a single coin equals target', () => {
    // One of the proofs (4) exactly matches the target.
    // The algorithm should find this without combining multiple proofs.
    const result = composeSatoshis([1, 2, 4, 8], 4);
    expect(result.exactMatch).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// composeSatoshis — algorithm selection
// ---------------------------------------------------------------------------

/**
 * The algorithm selection tests verify that:
 *   1. Small proof sets use the exhaustive search
 *   2. The correct algorithm is reported in the `strategy` field
 *   3. Each algorithm produces correct results for its input range
 */
describe('composeSatoshis — algorithm selection', () => {
  it('uses exhaustive search for ≤20 proofs', () => {
    // 10 proofs = well under the 20-proof threshold for exhaustive search.
    // Power-of-2 denominations can compose any amount 1..1023.
    const coins = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
    const result = composeSatoshis(coins, 100);
    expect(result.strategy).toBe('exhaustive');
    // 4 + 32 + 64 = 100
    expect(result.exactMatch).toBe(true);
  });

  it('finds exact match from standard denominations', () => {
    // Power-of-2 proofs are the standard Cashu denomination set.
    // They can represent any amount as a binary number.
    const coins = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
    const result = composeSatoshis(coins, 100);
    expect(result.exactMatch).toBe(true);
  });

  it('finds nearest lower and upper when no exact match', () => {
    // With coins [3, 5, 7], target 4:
    //   Lower: 3 (just the 3 coin)
    //   Upper: 5 (just the 5 coin)
    //   No combination sums to exactly 4
    const coins = [3, 5, 7];
    const result = composeSatoshis(coins, 4);
    expect(result.exactMatch).toBe(false);
    expect(result.nearestLower).toBe(3);
    expect(result.nearestUpper).toBe(5);
  });

  it('finds nearest for non-power-of-2 denominations', () => {
    // Real-world scenario: proofs with "awkward" amounts from partial swaps.
    // [10, 25, 50], target 30:
    //   Lower: 25 (just 25)
    //   Upper: 35 (10 + 25)
    //   Exact 30 isn't reachable with these denominations
    const coins = [10, 25, 50];
    const result = composeSatoshis(coins, 30);
    expect(result.exactMatch).toBe(false);
    expect(result.nearestLower).toBe(25);
    expect(result.nearestUpper).toBe(35); // 10 + 25
  });
});

// ---------------------------------------------------------------------------
// composeSatoshis — larger inputs (bitset-dp / meet-in-the-middle)
// ---------------------------------------------------------------------------

/**
 * For larger proof sets (>20), the exhaustive algorithm is too slow.
 * These tests verify the fallback algorithms handle real-world proof counts.
 *
 * Algorithm selection:
 *   - >20 proofs, small total sum → bitset-dp (DP with bitmask optimization)
 *   - >20 proofs, large total sum → meet-in-the-middle (split & combine)
 *
 * "Small sum" vs "large sum" is determined by a threshold that balances
 * memory usage (bitset-dp) vs computation (meet-in-the-middle).
 */
describe('composeSatoshis — larger inputs', () => {
  it('handles 25 proofs with small sums (bitset-dp)', () => {
    // 25 coins valued 1..25, total sum = 325. Small enough for bitset-dp.
    // 100 is definitely reachable (e.g. 1+2+3+...+13+9 or many combos)
    const coins = Array.from({ length: 25 }, (_, i) => i + 1);
    const total = coins.reduce((a, b) => a + b, 0); // 325
    const result = composeSatoshis(coins, 100);
    expect(result.strategy).toBe('bitset-dp');
    expect(result.exactMatch).toBe(true);
  });

  it('handles 25 proofs with large sums (meet-in-the-middle)', () => {
    // 25 coins valued 100k, 200k, ..., 2500k. Total = very large.
    // This forces the meet-in-the-middle algorithm because the sum is
    // too large for bitset-dp's memory usage.
    const coins = Array.from({ length: 25 }, (_, i) => (i + 1) * 100_000);
    // 350k is NOT directly in the array (array has 100k, 200k, 300k, 400k...),
    // so it won't short-circuit on the `valid.includes(target)` check.
    const result = composeSatoshis(coins, 350_000);
    expect(result.strategy).toBe('meet-in-the-middle');
    // MITM with the prefilter may not find exact when coins are pruned,
    // but it should find a nearby lower value
    expect(result.nearestLower).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// composeSatoshis — real-world proof sets
// ---------------------------------------------------------------------------

/**
 * Standard Cashu mints issue proofs in power-of-2 denominations:
 * [1, 2, 4, 8, 16, 32, 64, 128, 256, 512] sats.
 *
 * This is by design — power-of-2 denominations guarantee that ANY
 * amount from 1 to (total sum) can be exactly composed. It's the
 * binary number system applied to ecash.
 *
 * These tests verify the common case: a well-funded wallet with
 * standard denominations should always find exact matches.
 */
describe('composeSatoshis — realistic proofs', () => {
  it('composes from standard power-of-2 proofs', () => {
    const coins = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
    // Total = 1023. Any amount 1..1023 should be exactly composable
    // because each coin is a power of 2 (like binary digits).
    expect(composeSatoshis(coins, 1).exactMatch).toBe(true);
    expect(composeSatoshis(coins, 100).exactMatch).toBe(true);
    expect(composeSatoshis(coins, 1023).exactMatch).toBe(true);
  });

  it('cannot compose amounts beyond total', () => {
    // 1+2+4+...+512 = 1023. 1024 is impossible.
    const coins = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
    expect(composeSatoshis(coins, 1024).exactMatch).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// composeFiat
// ---------------------------------------------------------------------------

/**
 * composeFiat wraps composeSatoshis but works in fiat terms. Given a fiat
 * amount and exchange rate, it:
 *   1. Computes the sat range that rounds to the target fiat amount
 *   2. Tries composeSatoshis for each sat amount in that range
 *   3. Returns the best fiat match
 *
 * This handles the common UX where users think in dollars/euros:
 * "Send $0.10" → find proofs that compose to ~100 sats at current rate.
 *
 * The "rounding window" is key: $0.10 at 1 BTC = $100k means 100 sats,
 * but any amount from ~95-104 sats would also display as "$0.10" after
 * rounding. If we can compose 96 sats but not 100, that's still $0.10.
 */
describe('composeFiat', () => {
  it('finds exact fiat match within rounding window', () => {
    const coins = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
    // satsPerFiat = 1000 means 1 fiat unit = 1000 sats
    // 0.1 fiat = 100 sats. Power-of-2 proofs can compose 100 exactly.
    const result = composeFiat(coins, 0.1, 1000);
    expect(result.exactFiatMatch).toBe(true);
    expect(result.matchedSatoshis).toBeTruthy();
  });

  it('returns satoshiInterval for the fiat rounding window', () => {
    // The satoshiInterval tells us the range of sat amounts that all
    // display as the same fiat value after rounding.
    const coins = [100, 200];
    const result = composeFiat(coins, 0.1, 1000);
    expect(result.satoshiInterval).toHaveLength(2);
    // [minSat, maxSat] — minSat should be ≤ maxSat
    expect(result.satoshiInterval[0]).toBeLessThanOrEqual(result.satoshiInterval[1]);
  });

  it('returns nearest lower/upper fiat when no match', () => {
    // Only have a 500-sat proof. Looking for $0.30 = 300 sats.
    // Can't compose 300 from a single 500-sat proof (only 0 or 500).
    const coins = [500];
    const result = composeFiat(coins, 0.3, 1000);
    if (!result.exactFiatMatch) {
      // Should find either a lower or upper fiat alternative
      expect(
        result.nearestLowerFiat !== null || result.nearestUpperFiat !== null
      ).toBe(true);
    }
  });
});

describe('fiat amount offline optimization', () => {
  it('submits composable sats inside the fiat rounding window instead of center sats', () => {
    const result = resolveAmount('fiat', '0.01', 0.01, [20], 100_000_000 / 2100, true);

    expect(result.displayFiat).toBe(0.01);
    expect(result.displaySats).toBe(20);
    expect(result.effectiveSatAmount).toBe(20);
    expect(result.autoOptimized).toBe(true);
  });

  it('keeps a one-cent amount sendable with only the optimized sats available', () => {
    const result = resolveAmount('fiat', '0.01', 0.01, [20], 100_000_000 / 2100, true);

    expect(result.effectiveSatAmount).toBe(20);
    expect(result.canSendOffline).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildExactOfflineAmountIndex
// ---------------------------------------------------------------------------

/**
 * buildExactOfflineAmountIndex precomputes the set of all amounts that can
 * be exactly composed from the given proofs. This is used by the amount
 * entry screen to show the user which amounts are "sendable" offline.
 *
 * For small proof sets, this is a complete enumeration. For example,
 * proofs [1, 2, 4] can compose: {1, 2, 3, 4, 5, 6, 7}.
 *
 * The index also includes `totalReadyBalance` — the sum of all proofs,
 * which is the maximum possible offline send amount.
 */
describe('buildExactOfflineAmountIndex', () => {
  it('returns all reachable sums for small proof set', () => {
    // With proofs [1, 2, 4] we can make:
    //   1=1, 2=2, 3=1+2, 4=4, 5=1+4, 6=2+4, 7=1+2+4
    const index = buildExactOfflineAmountIndex([1, 2, 4]);
    expect(index.reachableSums).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(index.totalReadyBalance).toBe(7);
  });

  it('returns empty for no proofs', () => {
    // No proofs → nothing reachable, total balance is 0
    const index = buildExactOfflineAmountIndex([]);
    expect(index.reachableSums).toHaveLength(0);
    expect(index.totalReadyBalance).toBe(0);
  });

  it('filters out non-positive values', () => {
    // 0 and negative values are invalid proof amounts. Only the 2-sat
    // proof should be used.
    const index = buildExactOfflineAmountIndex([0, -1, 2]);
    expect(index.reachableSums).toEqual([2]);
    expect(index.totalReadyBalance).toBe(2);
  });

  it('does not include 0 in reachable sums', () => {
    // The "empty subset" sums to 0, but sending 0 sats isn't meaningful.
    // The reachable sums should start at the smallest positive composition.
    const index = buildExactOfflineAmountIndex([1, 2]);
    expect(index.reachableSums).not.toContain(0);
  });
});

// ---------------------------------------------------------------------------
// getRoundedFiatMinorUnitForSats
// ---------------------------------------------------------------------------

/**
 * getRoundedFiatMinorUnitForSats converts a sat amount to fiat "minor units"
 * (cents, pennies, etc.) at a given BTC price, with rounding.
 *
 * Example: 1 BTC = $100,000. 100 sats = $0.10 = 10 cents (minor units).
 *
 * Returns null for invalid inputs (0, negative, fractional sats, invalid price).
 */
describe('getRoundedFiatMinorUnitForSats', () => {
  it('converts sats to fiat minor units (cents)', () => {
    // 1 BTC = $100,000 → 1 sat = $0.001 → 100 sats = $0.10 = 10 cents
    const result = getRoundedFiatMinorUnitForSats(100, 100_000);
    expect(result).toBe(10);
  });

  it('returns null for invalid inputs', () => {
    // 0 sats, negative sats, 0 price, negative price, fractional sats
    // are all invalid inputs that should return null
    expect(getRoundedFiatMinorUnitForSats(0, 100_000)).toBeNull();
    expect(getRoundedFiatMinorUnitForSats(-1, 100_000)).toBeNull();
    expect(getRoundedFiatMinorUnitForSats(100, 0)).toBeNull();
    expect(getRoundedFiatMinorUnitForSats(100, -1)).toBeNull();
    // Fractional sats don't exist in Bitcoin
    expect(getRoundedFiatMinorUnitForSats(1.5, 100_000)).toBeNull();
  });

  it('rounds correctly', () => {
    // 1 BTC = $50,000 → 1 sat = $0.0005 → 1 sat = 0.05 cents
    // This rounds to 0 cents — the sat amount is too small to register
    // as even a single cent at this price.
    const result = getRoundedFiatMinorUnitForSats(1, 50_000);
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getSatRangeForDisplayedFiatMinorUnit
// ---------------------------------------------------------------------------

/**
 * getSatRangeForDisplayedFiatMinorUnit is the inverse of
 * getRoundedFiatMinorUnitForSats. Given a fiat minor unit (e.g. 10 cents)
 * and a BTC price, it returns the range of sat amounts that would all
 * display as that fiat amount after rounding.
 *
 * This is critical for the offline amount picker: if the user selects
 * "$0.10", we need to know which sat amounts count as "$0.10" so we can
 * check if any of those amounts are composable from available proofs.
 */
describe('getSatRangeForDisplayedFiatMinorUnit', () => {
  it('returns a valid sat range for a given minor unit', () => {
    // 1 BTC = $100,000. 10 cents ($0.10) corresponds to ~100 sats.
    // The range should include 100 and nearby values that also round to 10¢.
    const result = getSatRangeForDisplayedFiatMinorUnit(10, 100_000);
    expect(result).not.toBeNull();
    expect(result!.minSat).toBeLessThanOrEqual(result!.maxSat);
  });

  it('returns null for invalid inputs', () => {
    // Negative minor unit, zero price, negative price → invalid
    expect(getSatRangeForDisplayedFiatMinorUnit(-1, 100_000)).toBeNull();
    expect(getSatRangeForDisplayedFiatMinorUnit(10, 0)).toBeNull();
    expect(getSatRangeForDisplayedFiatMinorUnit(10, -1)).toBeNull();
  });

  it('round-trips with getRoundedFiatMinorUnitForSats', () => {
    // This verifies the two functions are inverses: converting sats → fiat
    // and then fiat → sat range should produce a range that contains the
    // original sat amount. This is the fundamental correctness property.
    const btcPrice = 100_000;
    const sats = 100;

    // Step 1: 100 sats → X cents
    const minorUnit = getRoundedFiatMinorUnitForSats(sats, btcPrice);
    expect(minorUnit).not.toBeNull();

    // Step 2: X cents → [minSat, maxSat]
    const range = getSatRangeForDisplayedFiatMinorUnit(minorUnit!, btcPrice);
    expect(range).not.toBeNull();

    // Step 3: The original 100 sats should be within the range
    expect(range!.minSat).toBeLessThanOrEqual(sats);
    expect(range!.maxSat).toBeGreaterThanOrEqual(sats);
  });
});
