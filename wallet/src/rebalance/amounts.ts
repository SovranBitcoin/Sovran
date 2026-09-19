// Pure amount decisions for one rebalance transfer.

type TransferAmountDecision =
  | { status: 'skip'; minRequired: number }
  | { status: 'ready'; amount: number; capped: false }
  | { status: 'capped'; amount: number; capped: true };

/** Whole sats, or null for a negative or non-finite value. */
export function toWholeSats(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.trunc(value);
}

/** Static headroom used when the mint's proof set cannot be read. */
export function staticFeeHeadroom(minFeeReserve: number): number {
  return minFeeReserve + 2;
}

/** Fee reserve floor plus the input fee of spending every ready proof. */
export function feeHeadroomFor(minFeeReserve: number, worstCaseInputFee: number): number {
  return Math.max(staticFeeHeadroom(minFeeReserve), minFeeReserve + worstCaseInputFee);
}

/**
 * Decide whether a transfer runs as requested, runs capped to what the source
 * can pay after fees, or is skipped because the source cannot cover the
 * minimum transfer plus fees.
 */
export function computeInitialTransferAmount({
  requestedAmount,
  sourceBalance,
  minTransferThreshold,
  feeHeadroom,
}: {
  requestedAmount: number;
  sourceBalance: number;
  minTransferThreshold: number;
  feeHeadroom: number;
}): TransferAmountDecision {
  const minRequired = minTransferThreshold + feeHeadroom;
  const requestedSatAmount = toWholeSats(requestedAmount) ?? 0;
  if (sourceBalance < minRequired || requestedSatAmount < minTransferThreshold) {
    return { status: 'skip', minRequired };
  }
  if (requestedSatAmount + feeHeadroom > sourceBalance) {
    return { status: 'capped', amount: toWholeSats(sourceBalance - feeHeadroom) ?? 0, capped: true };
  }
  return { status: 'ready', amount: requestedSatAmount, capped: false };
}

/**
 * Re-cap an amount once the mint's real fee reserve is known. Returns the new
 * amount, or null when the current amount already fits or the capped amount
 * would fall below the transfer threshold.
 */
export function recapForProbedHeadroom({
  amount,
  sourceBalance,
  headroom,
  minTransferThreshold,
}: {
  amount: number;
  sourceBalance: number;
  headroom: number;
  minTransferThreshold: number;
}): number | null {
  if (amount + headroom <= sourceBalance) return null;
  const capped = toWholeSats(sourceBalance - headroom) ?? 0;
  return capped >= minTransferThreshold ? capped : null;
}
