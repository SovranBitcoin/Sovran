type ProofAmount = {
  amount: number;
};

const SATS_PER_BTC = 100_000_000;
const BITSET_LIMIT = 2_000_000;
const EXHAUSTIVE_LIMIT = 20;
const MITM_LIMIT = 40;
const DEFAULT_FIAT_MINOR_UNIT_STEPS = 5;
const RANGE_EPSILON = 1e-9;

type OfflineProofService = {
  getReadyProofs: (mintUrl: string) => Promise<ProofAmount[]>;
  selectProofsToSend: (
    mintUrl: string,
    amount: number,
    includeFees: boolean
  ) => Promise<ProofAmount[]>;
};

export interface CompositionResult {
  exactMatch: boolean;
  target: number;
  nearestLower: number | null;
  nearestUpper: number | null;
  strategy: 'exhaustive' | 'meet-in-the-middle' | 'bitset-dp';
  elapsedMs: number;
}

export interface FiatCompositionResult {
  requestedFiat: number;
  satoshiInterval: [number, number];
  exactFiatMatch: boolean;
  matchedSatoshis: number | null;
  nearestLowerFiat: { fiat: number; satoshis: number } | null;
  nearestUpperFiat: { fiat: number; satoshis: number } | null;
  elapsedMs: number;
}

export type OfflineSendSuggestions = {
  isRequestedAmountSendableOffline: boolean;
  roundDownAmount: number | null;
  roundUpAmount: number | null;
  totalReadyBalance: number;
};

export type OfflineFiatSuggestionOption = {
  amount: number;
  displayMinorUnit: number;
};

export type OfflineFiatSendSuggestions = {
  autoSelectAmount: number | null;
  requestedDisplayMinorUnit: number;
  roundDownOption: OfflineFiatSuggestionOption | null;
  roundUpOption: OfflineFiatSuggestionOption | null;
  totalReadyBalance: number;
};

export type ExactOfflineAmountIndex = {
  reachableSums: number[];
  totalReadyBalance: number;
};

export type FiatMinorUnitSatRange = {
  minSat: number;
  maxSat: number;
};

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isFinitePositiveNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function sumProofAmounts(proofs: ProofAmount[]): number {
  return proofs.reduce((sum, proof) => sum + proof.amount, 0);
}

function buildReachableSums(proofAmounts: number[], maxAmount: number): number[] {
  const reachable = new Set<number>([0]);

  for (const proofAmount of proofAmounts) {
    const nextSums: number[] = [];
    for (const currentSum of reachable) {
      const nextSum = currentSum + proofAmount;
      if (nextSum <= maxAmount) {
        nextSums.push(nextSum);
      }
    }

    for (const nextSum of nextSums) {
      reachable.add(nextSum);
    }
  }

  return [...reachable].sort((a, b) => a - b);
}

function findInsertionIndex(sortedValues: number[], target: number): number {
  let low = 0;
  let high = sortedValues.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((sortedValues[mid] ?? 0) < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function getRangeBounds(sortedValues: number[], minValue: number, maxValue: number) {
  const startIndex = findInsertionIndex(sortedValues, minValue);
  const endIndex = findInsertionIndex(sortedValues, maxValue + 1);

  if (startIndex >= endIndex) {
    return null;
  }

  return { startIndex, endIndex };
}

function buildCandidateIndicesByCloseness(
  sortedValues: number[],
  startIndex: number,
  endIndex: number,
  preferredAmount: number
): number[] {
  const candidateIndices: number[] = [];

  if (startIndex >= endIndex) {
    return candidateIndices;
  }

  let left = findInsertionIndex(sortedValues, preferredAmount) - 1;
  let right = left + 1;

  while (left >= startIndex || right < endIndex) {
    const leftDistance =
      left >= startIndex
        ? Math.abs((sortedValues[left] ?? 0) - preferredAmount)
        : Number.POSITIVE_INFINITY;
    const rightDistance =
      right < endIndex
        ? Math.abs((sortedValues[right] ?? 0) - preferredAmount)
        : Number.POSITIVE_INFINITY;

    if (leftDistance <= rightDistance && left >= startIndex) {
      candidateIndices.push(left);
      left -= 1;
      continue;
    }

    if (right < endIndex) {
      candidateIndices.push(right);
      right += 1;
    }
  }

  return candidateIndices;
}

function result(
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

function bitLength(value: bigint): number {
  return value > 0n ? value.toString(2).length : 0;
}

function lowestSetBit(value: bigint): number {
  if (value === 0n) return -1;
  const isolated = value & -value;
  return bitLength(isolated) - 1;
}

function binarySearchClosest(sortedValues: number[], target: number): number {
  let low = 0;
  let high = sortedValues.length;

  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((sortedValues[mid] ?? 0) < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function generateSubsetSums(values: number[]): number[] {
  const count = 1 << values.length;
  const sums = new Array<number>(count);
  sums[0] = 0;

  for (let mask = 1; mask < count; mask += 1) {
    const leastSignificantBit = mask & -mask;
    const bitIndex = Math.log2(leastSignificantBit);
    sums[mask] = (sums[mask ^ leastSignificantBit] ?? 0) + (values[bitIndex] ?? 0);
  }

  return sums;
}

function exhaustiveSearch(
  coins: number[],
  target: number,
  startedAt: number
): CompositionResult {
  const totalSubsets = 1 << coins.length;
  let bestLower: number | null = null;
  let bestUpper: number | null = null;
  let exactMatch = false;

  for (let mask = 1; mask < totalSubsets; mask += 1) {
    let sum = 0;
    for (let coinIndex = 0; coinIndex < coins.length; coinIndex += 1) {
      if (mask & (1 << coinIndex)) {
        sum += coins[coinIndex] ?? 0;
      }
    }

    if (sum === target) {
      exactMatch = true;
      bestLower = target;
      bestUpper = target;
      break;
    }

    if (sum < target && (bestLower === null || sum > bestLower)) {
      bestLower = sum;
    }

    if (sum > target && (bestUpper === null || sum < bestUpper)) {
      bestUpper = sum;
    }
  }

  return result(exactMatch, target, bestLower, bestUpper, 'exhaustive', startedAt);
}

function meetInTheMiddle(coins: number[], target: number, startedAt: number): CompositionResult {
  const midpoint = Math.floor(coins.length / 2);
  const leftSums = generateSubsetSums(coins.slice(0, midpoint));
  const rightSums = generateSubsetSums(coins.slice(midpoint)).sort((a, b) => a - b);

  let bestLower: number | null = null;
  let bestUpper: number | null = null;
  let exactMatch = false;

  for (const leftSum of leftSums) {
    const complement = target - leftSum;
    const closestIndex = binarySearchClosest(rightSums, complement);

    for (const candidateIndex of [closestIndex - 1, closestIndex, closestIndex + 1]) {
      if (candidateIndex < 0 || candidateIndex >= rightSums.length) continue;

      const total = leftSum + (rightSums[candidateIndex] ?? 0);
      if (total === 0) continue;

      if (total === target) {
        exactMatch = true;
        bestLower = target;
        bestUpper = target;
      }

      if (total <= target && (bestLower === null || total > bestLower)) {
        bestLower = total;
      }

      if (total >= target && (bestUpper === null || total < bestUpper)) {
        bestUpper = total;
      }
    }

    if (exactMatch) {
      break;
    }
  }

  return result(exactMatch, target, bestLower, bestUpper, 'meet-in-the-middle', startedAt);
}

function bitsetDP(coins: number[], target: number, startedAt: number): CompositionResult {
  let bits = 1n;

  for (const coin of coins) {
    bits |= bits << BigInt(coin);
  }

  const targetBit = BigInt(target);
  const exactMatch = (bits & (1n << targetBit)) !== 0n;

  const lowerMask = (1n << (targetBit + 1n)) - 1n;
  const lowerBits = bits & lowerMask;
  let nearestLower: number | null = null;
  if (lowerBits > 0n) {
    nearestLower = bitLength(lowerBits) - 1;
    if (nearestLower === 0) {
      nearestLower = null;
    }
  }

  const upperBits = bits >> targetBit;
  const offset = lowestSetBit(upperBits);
  const nearestUpper = offset >= 0 ? target + offset : null;

  return result(exactMatch, target, nearestLower, nearestUpper, 'bitset-dp', startedAt);
}

function prefilterCoins(coins: number[], target: number, maxCoins: number): number[] {
  const sorted = [...coins].sort((a, b) => a - b);
  const atOrBelow = sorted.filter((coin) => coin <= target).reverse();
  const above = sorted.filter((coin) => coin > target);

  const selected: number[] = [];
  const aboveSlots = Math.min(3, above.length, maxCoins);
  const belowSlots = maxCoins - aboveSlots;

  for (let index = 0; index < Math.min(belowSlots, atOrBelow.length); index += 1) {
    selected.push(atOrBelow[index] ?? 0);
  }

  for (let index = 0; index < aboveSlots; index += 1) {
    selected.push(above[index] ?? 0);
  }

  return selected;
}

function roundFiat(value: number): number {
  return Math.round(value * 100) / 100;
}

async function isExactOfflineAmount(
  proofService: OfflineProofService,
  mintUrl: string,
  amount: number
): Promise<boolean> {
  if (!isPositiveInteger(amount)) return false;

  try {
    const selectedProofs = await proofService.selectProofsToSend(mintUrl, amount, false);
    return selectedProofs.length > 0 && sumProofAmounts(selectedProofs) === amount;
  } catch {
    return false;
  }
}

async function findNearestValidatedReachableAmountInRange(
  proofService: OfflineProofService,
  mintUrl: string,
  reachableSums: number[],
  minAmount: number,
  maxAmount: number,
  preferredAmount: number
): Promise<number | null> {
  const bounds = getRangeBounds(reachableSums, minAmount, maxAmount);
  if (!bounds) {
    return null;
  }

  const candidateIndices = buildCandidateIndicesByCloseness(
    reachableSums,
    bounds.startIndex,
    bounds.endIndex,
    preferredAmount
  );

  for (const candidateIndex of candidateIndices) {
    const candidateAmount = reachableSums[candidateIndex];
    if (candidateAmount != null && (await isExactOfflineAmount(proofService, mintUrl, candidateAmount))) {
      return candidateAmount;
    }
  }

  return null;
}

async function findNearestValidatedLowerCandidate(
  proofService: OfflineProofService,
  mintUrl: string,
  proofAmounts: number[],
  target: number
): Promise<number | null> {
  let searchTarget = target;

  while (searchTarget > 0) {
    const composition = composeSatoshis(proofAmounts, searchTarget);
    const candidate = composition.exactMatch ? searchTarget : composition.nearestLower;
    if (candidate == null) {
      return null;
    }

    if (await isExactOfflineAmount(proofService, mintUrl, candidate)) {
      return candidate;
    }

    searchTarget = candidate - 1;
  }

  return null;
}

async function findNearestValidatedUpperCandidate(
  proofService: OfflineProofService,
  mintUrl: string,
  proofAmounts: number[],
  target: number,
  totalReadyBalance: number
): Promise<number | null> {
  let searchTarget = target;

  while (searchTarget <= totalReadyBalance) {
    const composition = composeSatoshis(proofAmounts, searchTarget);
    const candidate = composition.exactMatch ? searchTarget : composition.nearestUpper;
    if (candidate == null) {
      return null;
    }

    if (await isExactOfflineAmount(proofService, mintUrl, candidate)) {
      return candidate;
    }

    searchTarget = candidate + 1;
  }

  return null;
}

export function buildExactOfflineAmountIndex(proofAmounts: number[]): ExactOfflineAmountIndex {
  const validProofAmounts = proofAmounts.filter((amount) => isPositiveInteger(amount));
  const totalReadyBalance = validProofAmounts.reduce((sum, amount) => sum + amount, 0);

  if (validProofAmounts.length === 0 || totalReadyBalance === 0) {
    return {
      reachableSums: [],
      totalReadyBalance,
    };
  }

  return {
    reachableSums: buildReachableSums(validProofAmounts, totalReadyBalance).filter((sum) => sum > 0),
    totalReadyBalance,
  };
}

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
  if (!isFinitePositiveNumber(minorUnitsPerBtc)) {
    return null;
  }

  const rawMinSat = ((targetMinorUnit - 0.5) * SATS_PER_BTC) / minorUnitsPerBtc;
  const rawMaxExclusiveSat = ((targetMinorUnit + 0.5) * SATS_PER_BTC) / minorUnitsPerBtc;
  const minSat = Math.max(1, Math.ceil(rawMinSat - RANGE_EPSILON));
  const maxSat = Math.max(0, Math.floor(rawMaxExclusiveSat - RANGE_EPSILON));

  if (maxSat < minSat) {
    return null;
  }

  return { minSat, maxSat };
}

export function composeSatoshis(coins: number[], target: number): CompositionResult {
  const startedAt = performance.now();

  if (coins.length === 0) {
    return result(false, target, null, null, 'exhaustive', startedAt);
  }

  const validCoins = coins.filter((coin) => coin > 0);
  if (validCoins.length === 0) {
    return result(false, target, null, null, 'exhaustive', startedAt);
  }

  const totalSum = validCoins.reduce((sum, coin) => sum + coin, 0);

  if (target <= 0) {
    return result(
      false,
      target,
      null,
      validCoins.length > 0 ? Math.min(...validCoins) : null,
      'exhaustive',
      startedAt
    );
  }

  if (totalSum === target) {
    return result(true, target, target, target, 'exhaustive', startedAt);
  }

  if (totalSum < target) {
    return result(false, target, totalSum, null, 'exhaustive', startedAt);
  }

  if (validCoins.includes(target)) {
    return result(true, target, target, target, 'exhaustive', startedAt);
  }

  if (validCoins.length <= EXHAUSTIVE_LIMIT) {
    return exhaustiveSearch(validCoins, target, startedAt);
  }

  if (totalSum <= BITSET_LIMIT) {
    return bitsetDP(validCoins, target, startedAt);
  }

  const coinsForMitm =
    validCoins.length <= MITM_LIMIT ? validCoins : prefilterCoins(validCoins, target, MITM_LIMIT);
  return meetInTheMiddle(coinsForMitm, target, startedAt);
}

export function composeFiat(
  coins: number[],
  fiatAmount: number,
  satsPerFiat: number
): FiatCompositionResult {
  const startedAt = performance.now();

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
      elapsedMs: performance.now() - startedAt,
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
    elapsedMs: performance.now() - startedAt,
  };
}

export async function getOfflineSendSuggestions(
  proofService: OfflineProofService,
  mintUrl: string,
  requestedAmount: number
): Promise<OfflineSendSuggestions> {
  if (!isPositiveInteger(requestedAmount)) {
    return {
      isRequestedAmountSendableOffline: false,
      roundDownAmount: null,
      roundUpAmount: null,
      totalReadyBalance: 0,
    };
  }

  // Fast path: when amount is already sendable, skip expensive index building.
  // Round up/down clicks bypass this entirely (they call handleEcashSend directly).
  if (await isExactOfflineAmount(proofService, mintUrl, requestedAmount)) {
    return {
      isRequestedAmountSendableOffline: true,
      roundDownAmount: null,
      roundUpAmount: null,
      totalReadyBalance: 0,
    };
  }

  const readyProofs = await proofService.getReadyProofs(mintUrl);
  const proofAmounts = readyProofs.map((proof) => proof.amount);
  const { totalReadyBalance } = buildExactOfflineAmountIndex(proofAmounts);

  if (totalReadyBalance === 0) {
    return {
      isRequestedAmountSendableOffline: false,
      roundDownAmount: null,
      roundUpAmount: null,
      totalReadyBalance,
    };
  }

  const composition = composeSatoshis(proofAmounts, requestedAmount);
  const isRequestedAmountSendableOffline =
    composition.exactMatch && (await isExactOfflineAmount(proofService, mintUrl, requestedAmount));

  if (isRequestedAmountSendableOffline) {
    return {
      isRequestedAmountSendableOffline: true,
      roundDownAmount: null,
      roundUpAmount: null,
      totalReadyBalance,
    };
  }

  const [roundDownAmount, roundUpAmount] = await Promise.all([
    findNearestValidatedLowerCandidate(proofService, mintUrl, proofAmounts, requestedAmount - 1),
    findNearestValidatedUpperCandidate(
      proofService,
      mintUrl,
      proofAmounts,
      requestedAmount + 1,
      totalReadyBalance
    ),
  ]);

  return {
    isRequestedAmountSendableOffline: false,
    roundDownAmount,
    roundUpAmount,
    totalReadyBalance,
  };
}

export async function getOfflineFiatSendSuggestions(
  proofService: OfflineProofService,
  mintUrl: string,
  requestedAmount: number,
  requestedDisplayMinorUnit: number,
  btcPrice: number,
  minorUnitsPerUnit: number = 100,
  maxMinorUnitSteps: number = DEFAULT_FIAT_MINOR_UNIT_STEPS
): Promise<OfflineFiatSendSuggestions> {
  if (
    !isPositiveInteger(requestedAmount) ||
    !Number.isInteger(requestedDisplayMinorUnit) ||
    requestedDisplayMinorUnit < 0 ||
    !isFinitePositiveNumber(btcPrice) ||
    !isPositiveInteger(minorUnitsPerUnit) ||
    !isPositiveInteger(maxMinorUnitSteps)
  ) {
    return {
      autoSelectAmount: null,
      requestedDisplayMinorUnit,
      roundDownOption: null,
      roundUpOption: null,
      totalReadyBalance: 0,
    };
  }

  // Fast path: when requested amount (in sats) is already sendable, skip expensive work.
  if (await isExactOfflineAmount(proofService, mintUrl, requestedAmount)) {
    return {
      autoSelectAmount: requestedAmount,
      requestedDisplayMinorUnit,
      roundDownOption: null,
      roundUpOption: null,
      totalReadyBalance: 0,
    };
  }

  const readyProofs = await proofService.getReadyProofs(mintUrl);
  const proofAmounts = readyProofs.map((proof) => proof.amount);
  const { reachableSums, totalReadyBalance } = buildExactOfflineAmountIndex(proofAmounts);

  if (reachableSums.length === 0 || totalReadyBalance === 0) {
    return {
      autoSelectAmount: null,
      requestedDisplayMinorUnit,
      roundDownOption: null,
      roundUpOption: null,
      totalReadyBalance,
    };
  }

  const satsPerFiat = SATS_PER_BTC / btcPrice;
  const fiatComposition = composeFiat(
    proofAmounts,
    requestedDisplayMinorUnit / minorUnitsPerUnit,
    satsPerFiat
  );

  const [minSat, maxSat] = fiatComposition.satoshiInterval;
  const autoSelectAmount = await findNearestValidatedReachableAmountInRange(
    proofService,
    mintUrl,
    reachableSums,
    minSat,
    maxSat,
    requestedAmount
  );

  if (autoSelectAmount != null) {
    return {
      autoSelectAmount,
      requestedDisplayMinorUnit,
      roundDownOption: null,
      roundUpOption: null,
      totalReadyBalance,
    };
  }

  let roundDownOption: OfflineFiatSuggestionOption | null = null;
  let roundUpOption: OfflineFiatSuggestionOption | null = null;

  for (let step = 1; step <= maxMinorUnitSteps; step += 1) {
    if (!roundDownOption) {
      const lowerMinorUnit = requestedDisplayMinorUnit - step;
      if (lowerMinorUnit >= 0) {
        const lowerRange = getSatRangeForDisplayedFiatMinorUnit(
          lowerMinorUnit,
          btcPrice,
          minorUnitsPerUnit
        );
        const lowerAmount = lowerRange
          ? await findNearestValidatedReachableAmountInRange(
              proofService,
              mintUrl,
              reachableSums,
              lowerRange.minSat,
              lowerRange.maxSat,
              requestedAmount
            )
          : null;

        if (lowerAmount != null) {
          roundDownOption = {
            amount: lowerAmount,
            displayMinorUnit: lowerMinorUnit,
          };
        }
      }
    }

    if (!roundUpOption) {
      const upperMinorUnit = requestedDisplayMinorUnit + step;
      const upperRange = getSatRangeForDisplayedFiatMinorUnit(
        upperMinorUnit,
        btcPrice,
        minorUnitsPerUnit
      );
      const upperAmount = upperRange
        ? await findNearestValidatedReachableAmountInRange(
            proofService,
            mintUrl,
            reachableSums,
            upperRange.minSat,
            upperRange.maxSat,
            requestedAmount
          )
        : null;

      if (upperAmount != null) {
        roundUpOption = {
          amount: upperAmount,
          displayMinorUnit: upperMinorUnit,
        };
      }
    }

    if (roundDownOption && roundUpOption) {
      break;
    }
  }

  if (!roundDownOption && fiatComposition.nearestLowerFiat) {
    const fallbackMinorUnit = Math.round(fiatComposition.nearestLowerFiat.fiat * minorUnitsPerUnit);
    if (await isExactOfflineAmount(proofService, mintUrl, fiatComposition.nearestLowerFiat.satoshis)) {
      roundDownOption = {
        amount: fiatComposition.nearestLowerFiat.satoshis,
        displayMinorUnit: fallbackMinorUnit,
      };
    }
  }

  if (!roundUpOption && fiatComposition.nearestUpperFiat) {
    const fallbackMinorUnit = Math.round(fiatComposition.nearestUpperFiat.fiat * minorUnitsPerUnit);
    if (await isExactOfflineAmount(proofService, mintUrl, fiatComposition.nearestUpperFiat.satoshis)) {
      roundUpOption = {
        amount: fiatComposition.nearestUpperFiat.satoshis,
        displayMinorUnit: fallbackMinorUnit,
      };
    }
  }

  return {
    autoSelectAmount: null,
    requestedDisplayMinorUnit,
    roundDownOption,
    roundUpOption,
    totalReadyBalance,
  };
}
