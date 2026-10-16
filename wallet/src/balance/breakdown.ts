// ---------------------------------------------------------------------------
// Wallet balance breakdown (framework-agnostic)
// ---------------------------------------------------------------------------
//
// One shape describing wallet money in every state a UI needs:
//
//   spendable  — ready proofs (coco BalanceSnapshot.spendable)
//   reserved   — proofs claimed by an in-flight operation (BalanceSnapshot.reserved)
//   total      — spendable + reserved (coco BalanceSnapshot.total)
//   pending    — cancellable ecash SENDS awaiting finalize (subset of reserved)
//   redeeming  — received-but-unredeemed (executing) ecash, not in balance yet
//
// `spendable/reserved/total` come from coco's balance API; `pending` is derived
// from history (reserved sends) and `redeeming` from in-flight receive ops.
// Pure helpers here; the React binding (useColadaBalance) wires the data.

import type { BalancesByMint, HistoryEntry } from "@cashu/coco-core";

import { amountToNumber, type AmountValue } from "../amount";
import { isReservedPendingEcash } from "../history/filters";

export interface WalletBalanceBreakdown {
  spendable: number;
  reserved: number;
  total: number;
  pending: number;
  redeeming: number;
  byMint: BalancesByMint;
}

/**
 * Sum the amounts of reserved pending ecash sends in a history slice.
 *
 * Reserved, not cancellable: a P2PK-locked send cannot be taken back, but its
 * funds are just as gone from the spendable balance as any other pending
 * send's. Counting only the cancellable ones would report locked money as
 * spendable.
 */
export function sumReservedSends(history: readonly HistoryEntry[]): number {
  return history.reduce(
    (sum, entry) =>
      isReservedPendingEcash(entry)
        ? sum + amountToNumber((entry as { amount?: AmountValue }).amount)
        : sum,
    0,
  );
}

/** Sum a list of coco amounts (e.g. in-flight receive operation amounts). */
export function sumAmounts(values: readonly AmountValue[]): number {
  return values.reduce<number>((sum, value) => sum + amountToNumber(value), 0);
}

export function emptyBalanceBreakdown(): WalletBalanceBreakdown {
  return {
    spendable: 0,
    reserved: 0,
    total: 0,
    pending: 0,
    redeeming: 0,
    byMint: {},
  };
}
