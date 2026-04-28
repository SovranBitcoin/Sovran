// ---------------------------------------------------------------------------
// Proof Composition Primitives
//
// Pure math for analyzing which amounts are constructible from a set of
// proof denominations without a swap. The wallet uses these to power its
// own proof-selection UX (round up/down suggestions, proof picker, etc.).
//
// Algorithms: exhaustive (≤20 proofs), bitset-DP (sum ≤2M),
// meet-in-the-middle (≤40 proofs, larger sums).
// ---------------------------------------------------------------------------

import type {
  ExactOfflineAmountIndex,
  FiatMinorUnitSatRange,
  CompositionResult,
  FiatCompositionResult,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SATS_PER_BTC = 100_000_000;
const BITSET_LIMIT = 2_000_000;
// Per-coin cap for bitset-DP. `bits << BigInt(coin)` creates a BigInt that's
// `coin + 1` bits long; Hermes' BigInt representation tops out well before
// billions of bits, and even ~1M bits makes mount laggy. Any coin above this
// forces the algorithm chooser to fall back to meet-in-the-middle, which is
// insensitive to individual denomination size.
const BITSET_MAX_COIN = 1_000_000;
const EXHAUSTIVE_LIMIT = 20;
const MITM_LIMIT = 40;
const RANGE_EPSILON = 1e-9;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isFinitePositiveNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function roundFiat(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildReachableSums(proofAmounts: number[], maxAmount: number): number[] {
  const reachable = new Set<number>([0]);

  for (const amt of proofAmounts) {
    const nextSums: number[] = [];
    for (const current of reachable) {
      const next = current + amt;
      if (next <= maxAmount) nextSums.push(next);
    }
    for (const next of nextSums) reachable.add(next);
  }

  return [...reachable].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Composition result constructor
// ---------------------------------------------------------------------------

function compositionResult(
  exactMatch: boolean,
  target: number,
  nearestLower: number | null,
  nearestUpper: number | null,
  strategy: CompositionResult['strategy'],
  startedAt: number
): CompositionResult {
  return {
    exactMatch,
    target,
    nearestLower,
    nearestUpper,
    strategy,
    elapsedMs: performance.now() - startedAt,
  };
}

// ---------------------------------------------------------------------------
// Composition algorithms
// ---------------------------------------------------------------------------

function bitLength(value: bigint): number {
  return value > 0n ? value.toString(2).length : 0;
}

function lowestSetBit(value: bigint): number {
  if (value === 0n) return -1;
  return bitLength(value & -value) - 1;
}

function generateSubsetSums(values: number[]): number[] {
  const count = 1 << values.length;
  const sums = new Array<number>(count);
  sums[0] = 0;

  for (let mask = 1; mask < count; mask += 1) {
    const lsb = mask & -mask;
    const idx = Math.log2(lsb);
    sums[mask] = (sums[mask ^ lsb] ?? 0) + (values[idx] ?? 0);
  }

  return sums;
}

function binarySearchClosest(sorted: number[], target: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] ?? 0) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function exhaustiveSearch(coins: number[], target: number, startedAt: number): CompositionResult {
  const total = 1 << coins.length;
  let bestLower: number | null = null;
  let bestUpper: number | null = null;
  let exact = false;

  for (let mask = 1; mask < total; mask += 1) {
    let sum = 0;
    for (let i = 0; i < coins.length; i += 1) {
      if (mask & (1 << i)) sum += coins[i] ?? 0;
    }

    if (sum === target) {
      exact = true;
      bestLower = target;
      bestUpper = target;
      break;
    }
    if (sum < target && (bestLower === null || sum > bestLower)) bestLower = sum;
    if (sum > target && (bestUpper === null || sum < bestUpper)) bestUpper = sum;
  }

  return compositionResult(exact, target, bestLower, bestUpper, 'exhaustive', startedAt);
}

function meetInTheMiddle(coins: number[], target: number, startedAt: number): CompositionResult {
  const mid = Math.floor(coins.length / 2);
  const leftSums = generateSubsetSums(coins.slice(0, mid));
  const rightSums = generateSubsetSums(coins.slice(mid)).sort((a, b) => a - b);

  let bestLower: number | null = null;
  let bestUpper: number | null = null;
  let exact = false;

  for (const ls of leftSums) {
    const complement = target - ls;
    const ci = binarySearchClosest(rightSums, complement);

    for (const idx of [ci - 1, ci, ci + 1]) {
      if (idx < 0 || idx >= rightSums.length) continue;
      const total = ls + (rightSums[idx] ?? 0);
      if (total === 0) continue;

      if (total === target) {
        exact = true;
        bestLower = target;
        bestUpper = target;
      }
      if (total <= target && (bestLower === null || total > bestLower)) bestLower = total;
      if (total >= target && (bestUpper === null || total < bestUpper)) bestUpper = total;
    }
    if (exact) break;
  }

  return compositionResult(exact, target, bestLower, bestUpper, 'meet-in-the-middle', startedAt);
}

function bitsetDP(coins: number[], target: number, startedAt: number): CompositionResult {
  let bits = 1n;
  for (const coin of coins) bits |= bits << BigInt(coin);

  const tBig = BigInt(target);
  const exact = (bits & (1n << tBig)) !== 0n;

  const lowerMask = (1n << (tBig + 1n)) - 1n;
  const lowerBits = bits & lowerMask;
  let nearestLower: number | null = lowerBits > 0n ? bitLength(lowerBits) - 1 : null;
  if (nearestLower === 0) nearestLower = null;

  const upperBits = bits >> tBig;
  const offset = lowestSetBit(upperBits);
  const nearestUpper = offset >= 0 ? target + offset : null;

  return compositionResult(exact, target, nearestLower, nearestUpper, 'bitset-dp', startedAt);
}

function prefilterCoins(coins: number[], target: number, maxCoins: number): number[] {
  const sorted = [...coins].sort((a, b) => a - b);
  const atOrBelow = sorted.filter((c) => c <= target).reverse();
  const above = sorted.filter((c) => c > target);

  const selected: number[] = [];
  const aboveSlots = Math.min(3, above.length, maxCoins);
  const belowSlots = maxCoins - aboveSlots;

  for (let i = 0; i < Math.min(belowSlots, atOrBelow.length); i += 1) {
    selected.push(atOrBelow[i] ?? 0);
  }
  for (let i = 0; i < aboveSlots; i += 1) {
    selected.push(above[i] ?? 0);
  }

  return selected;
}

// ---------------------------------------------------------------------------
// Public: Satoshi composition
// ---------------------------------------------------------------------------

/**
 * Analyze whether `target` sats can be composed exactly from the given
 * proof denominations, and find the nearest lower/upper amounts that can.
 *
 * Auto-selects the best algorithm based on input size.
 */
export function composeSatoshis(coins: number[], target: number): CompositionResult {
  const t0 = performance.now();

  if (coins.length === 0) {
    return compositionResult(false, target, null, null, 'exhaustive', t0);
  }

  const valid = coins.filter((c) => c > 0);
  if (valid.length === 0) {
    return compositionResult(false, target, null, null, 'exhaustive', t0);
  }

  const totalSum = valid.reduce((a, b) => a + b, 0);

  if (target <= 0) {
    return compositionResult(
      false,
      target,
      null,
      valid.length > 0 ? Math.min(...valid) : null,
      'exhaustive',
      t0
    );
  }
  if (totalSum === target) {
    return compositionResult(true, target, target, target, 'exhaustive', t0);
  }
  if (totalSum < target) {
    return compositionResult(false, target, totalSum, null, 'exhaustive', t0);
  }
  if (valid.includes(target)) {
    return compositionResult(true, target, target, target, 'exhaustive', t0);
  }

  const maxCoin = valid.reduce((m, c) => (c > m ? c : m), 0);
  const bitsetSafe = totalSum <= BITSET_LIMIT && maxCoin <= BITSET_MAX_COIN;

  let result: CompositionResult;
  try {
    if (valid.length <= EXHAUSTIVE_LIMIT) {
      result = exhaustiveSearch(valid, target, t0);
    } else if (bitsetSafe) {
      result = bitsetDP(valid, target, t0);
    } else {
      const selected =
        valid.length <= MITM_LIMIT ? valid : prefilterCoins(valid, target, MITM_LIMIT);
      result = meetInTheMiddle(selected, target, t0);
    }
  } catch (err) {
    // Defense in depth: if the chosen strategy throws (e.g. bitset-DP hitting
    // Hermes' BigInt ceiling on an unusually large denomination), degrade to
    // an unknown-composition result rather than crashing the amount screen.
    // eslint-disable-next-line no-console
    console.warn(
      '[composeSatoshis] strategy failed, returning unknown result',
      err instanceof Error ? err.message : err
    );
    result = compositionResult(false, target, null, null, 'exhaustive', t0);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public: Fiat composition
// ---------------------------------------------------------------------------

/**
 * Analyze whether a fiat amount maps to an exact satoshi composition,
 * accounting for the rounding window where multiple sat values display
 * as the same fiat amount.
 */
export function composeFiat(
  coins: number[],
  fiatAmount: number,
  satsPerFiat: number
): FiatCompositionResult {
  const t0 = performance.now();

  const fiatLow = fiatAmount - 0.005;
  const fiatHigh = fiatAmount + 0.005;
  const satLow = Math.max(1, Math.ceil(fiatLow * satsPerFiat));
  const satHigh = Math.floor(fiatHigh * satsPerFiat - 0.000001);
  const satoshiInterval: [number, number] = [satLow, satHigh];

  const highResult = composeSatoshis(coins, satHigh);

  let matchedSatoshis: number | null = null;
  if (highResult.exactMatch) {
    matchedSatoshis = satHigh;
  } else if (highResult.nearestLower !== null && highResult.nearestLower >= satLow) {
    matchedSatoshis = highResult.nearestLower;
  }

  let lowResult: CompositionResult | null = null;
  if (matchedSatoshis === null) {
    lowResult = composeSatoshis(coins, satLow);
    if (lowResult.exactMatch) {
      matchedSatoshis = satLow;
    } else if (lowResult.nearestUpper !== null && lowResult.nearestUpper <= satHigh) {
      matchedSatoshis = lowResult.nearestUpper;
    }
  }

  if (matchedSatoshis !== null) {
    return {
      requestedFiat: fiatAmount,
      satoshiInterval,
      exactFiatMatch: true,
      matchedSatoshis,
      nearestLowerFiat: null,
      nearestUpperFiat: null,
      elapsedMs: performance.now() - t0,
    };
  }

  let nearestLowerFiat: { fiat: number; satoshis: number } | null = null;
  if (highResult.nearestLower !== null && highResult.nearestLower < satLow) {
    nearestLowerFiat = {
      fiat: roundFiat(highResult.nearestLower / satsPerFiat),
      satoshis: highResult.nearestLower,
    };
  } else if (lowResult?.nearestLower != null) {
    nearestLowerFiat = {
      fiat: roundFiat(lowResult.nearestLower / satsPerFiat),
      satoshis: lowResult.nearestLower,
    };
  }

  let nearestUpperFiat: { fiat: number; satoshis: number } | null = null;
  if (highResult.nearestUpper !== null && highResult.nearestUpper > satHigh) {
    nearestUpperFiat = {
      fiat: roundFiat(highResult.nearestUpper / satsPerFiat),
      satoshis: highResult.nearestUpper,
    };
  } else {
    const upperResult = composeSatoshis(coins, satHigh + 1);
    if (upperResult.exactMatch) {
      nearestUpperFiat = {
        fiat: roundFiat((satHigh + 1) / satsPerFiat),
        satoshis: satHigh + 1,
      };
    } else if (upperResult.nearestUpper !== null) {
      nearestUpperFiat = {
        fiat: roundFiat(upperResult.nearestUpper / satsPerFiat),
        satoshis: upperResult.nearestUpper,
      };
    }
  }

  return {
    requestedFiat: fiatAmount,
    satoshiInterval,
    exactFiatMatch: false,
    matchedSatoshis: null,
    nearestLowerFiat,
    nearestUpperFiat,
    elapsedMs: performance.now() - t0,
  };
}

// ---------------------------------------------------------------------------
// Public: Index & ranges
// ---------------------------------------------------------------------------

/**
 * Build a reusable index of all amounts constructible from the given
 * proof denominations (subset sums). The wallet can use this index to
 * quickly check whether specific amounts are reachable.
 */
export function buildExactOfflineAmountIndex(proofAmounts: number[]): ExactOfflineAmountIndex {
  const valid = proofAmounts.filter(isPositiveInteger);
  const total = valid.reduce((a, b) => a + b, 0);

  if (valid.length === 0 || total === 0) {
    return { reachableSums: [], totalReadyBalance: total };
  }

  return {
    reachableSums: buildReachableSums(valid, total).filter((s) => s > 0),
    totalReadyBalance: total,
  };
}

/**
 * Convert a sat amount to the nearest displayed fiat minor unit
 * (e.g. cents). Returns null on invalid input.
 */
export function getRoundedFiatMinorUnitForSats(
  sats: number,
  btcPrice: number,
  minorUnitsPerUnit: number = 100
): number | null {
  if (
    !isPositiveInteger(sats) ||
    !isFinitePositiveNumber(btcPrice) ||
    !isPositiveInteger(minorUnitsPerUnit)
  ) {
    return null;
  }
  return Math.round((sats * btcPrice * minorUnitsPerUnit) / SATS_PER_BTC);
}

/**
 * Derive the sat range that rounds to a given displayed fiat minor unit.
 * All sats in [minSat, maxSat] display as the same fiat amount.
 */
export function getSatRangeForDisplayedFiatMinorUnit(
  targetMinorUnit: number,
  btcPrice: number,
  minorUnitsPerUnit: number = 100
): FiatMinorUnitSatRange | null {
  if (
    !Number.isInteger(targetMinorUnit) ||
    targetMinorUnit < 0 ||
    !isFinitePositiveNumber(btcPrice) ||
    !isPositiveInteger(minorUnitsPerUnit)
  ) {
    return null;
  }

  const minorUnitsPerBtc = btcPrice * minorUnitsPerUnit;
  if (!isFinitePositiveNumber(minorUnitsPerBtc)) return null;

  const rawMin = ((targetMinorUnit - 0.5) * SATS_PER_BTC) / minorUnitsPerBtc;
  const rawMaxExcl = ((targetMinorUnit + 0.5) * SATS_PER_BTC) / minorUnitsPerBtc;
  const minSat = Math.max(1, Math.ceil(rawMin - RANGE_EPSILON));
  const maxSat = Math.max(0, Math.floor(rawMaxExcl - RANGE_EPSILON));

  return maxSat >= minSat ? { minSat, maxSat } : null;
}
