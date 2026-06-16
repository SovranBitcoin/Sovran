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

import { isReservedSendHistoryEntry } from "../history/filters";

export interface WalletBalanceBreakdown {
  spendable: number;
  reserved: number;
  total: number;
  pending: number;
  redeeming: number;
  byMint: BalancesByMint;
}

type AmountLike = number | bigint | string | { toNumber(): number } | null | undefined;

/** Coerce a coco Amount (number | bigint | string | {toNumber}) to a number. */
export function amountToNumber(value: AmountLike): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value) || 0;
  if (typeof value.toNumber === "function") return value.toNumber();
  return 0;
}

/** Sum the amounts of cancellable pending ecash sends in a history slice. */
export function sumReservedSends(history: readonly HistoryEntry[]): number {
  return history.reduce(
    (sum, entry) =>
      isReservedSendHistoryEntry(entry)
        ? sum + amountToNumber((entry as { amount?: AmountLike }).amount)
        : sum,
    0,
  );
}

/** Sum a list of coco amounts (e.g. in-flight receive operation amounts). */
export function sumAmounts(values: readonly AmountLike[]): number {
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
