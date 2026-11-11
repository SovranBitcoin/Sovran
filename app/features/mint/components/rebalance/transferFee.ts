/**
 * What the planner budgets for the fees of one transfer. Kept apart from the
 * planner so readers of saved swaps can use it without the planner's stores.
 */

/**
 * Estimated fee for Lightning transfers in basis points (200 = 2%), so sat
 * amounts stay in integer math.
 * This is a conservative estimate to ensure we don't over-allocate from surplus mints.
 * Actual fees may be lower, but it's better to under-transfer than fail.
 */
export const ESTIMATED_FEE_BPS = 200;

/**
 * Minimum fee reserve in sats.
 * Must be high enough to cover the mint's Lightning fee_reserve (typically 2–10 sats)
 * plus potential input fees per proof.  5 sats is a safer planning floor that
 * reduces the chance of steps being skipped at execution time due to insufficient
 * headroom.  The executor handles the real fee_reserve dynamically via melt quote
 * probes, so this only affects upfront planning accuracy.
 */
export const MIN_FEE_RESERVE = 5;

/** The fee one transfer of `amount` is budgeted to cost: its share, never under the reserve floor. */
export function estimatedTransferFee(amount: number): number {
  // Basis points: 10,000 is the whole amount.
  return Math.max(Math.ceil((amount * ESTIMATED_FEE_BPS) / 10_000), MIN_FEE_RESERVE);
}
