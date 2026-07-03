import type { HistoryEntry, SendHistoryEntry } from "@cashu/coco-core";

import {
  getHistoryEntryOnchainMintAddress,
  mintHistoryEntryExpired,
} from "./timeline";

export type TransactionPaymentType = "all" | "lightning" | "ecash" | "onchain";
export type TransactionDirection = "all" | "incoming" | "outgoing";

/** Which list section a history entry belongs to. */
export type TransactionBucket = "pending" | "confirmed" | "expired";

// These predicates run per-entry per-filter-evaluation on the history list —
// tens of thousands of calls per session. Keep them log-free; log at the call
// site (once per list evaluation) if filter behavior needs tracing.

const CANCELLABLE_SEND_STATES = new Set(["pending", "prepared"]);

export function isCancellablePendingEcash(
  entry: HistoryEntry,
): entry is SendHistoryEntry {
  const state = String((entry as SendHistoryEntry).state ?? "");
  return entry.type === "send" && CANCELLABLE_SEND_STATES.has(state);
}

export function isReservedSendHistoryEntry(
  entry: HistoryEntry,
): entry is SendHistoryEntry {
  return isCancellablePendingEcash(entry);
}

export function isMintQuotePaymentObserved(
  entry: { state?: unknown; remoteState?: unknown } | null | undefined,
): boolean {
  const state = String(entry?.state ?? "");
  return (
    state === "executing" ||
    state === "finalized" ||
    state === "PAID" ||
    state === "ISSUED" ||
    entry?.remoteState === "ISSUED" ||
    entry?.remoteState === "PAID"
  );
}

export function isMeltQuotePaid(
  entry: { state?: unknown } | null | undefined,
): boolean {
  const state = String(entry?.state ?? "");
  return state === "finalized" || state === "PAID";
}

export function isMeltQuoteReadyToPay(
  entry: { state?: unknown } | null | undefined,
): boolean {
  const state = String(entry?.state ?? "");
  return state === "prepared" || state === "UNPAID";
}

export function isReceiveTokenRedeemed(
  entry: { state?: unknown } | null | undefined,
): boolean {
  return entry?.state === "finalized";
}

export function isReceiveTokenPending(
  entry: { state?: unknown } | null | undefined,
): boolean {
  return entry?.state === "executing";
}

export function isSendTokenComplete(
  entry: { state?: unknown } | null | undefined,
): boolean {
  return entry?.state === "finalized";
}

export function isSendTokenCancelled(
  entry: { state?: unknown } | null | undefined,
): boolean {
  const state = String(entry?.state ?? "");
  return state === "rolledBack" || state === "rolled_back";
}

export function isSettledSpendHistoryEntry(
  historyEntry: HistoryEntry,
): boolean {
  return historyEntry.type === "send"
    ? isSendTokenComplete(historyEntry)
    : historyEntry.type === "melt"
      ? isMeltQuotePaid(historyEntry)
      : false;
}

export function isSettledReceiveHistoryEntry(
  historyEntry: HistoryEntry,
): boolean {
  return historyEntry.type === "receive"
    ? true
    : historyEntry.type === "mint"
      ? String(historyEntry.state) === "PAID"
      : false;
}

export function isOnchainHistoryEntry(historyEntry: HistoryEntry): boolean {
  return !!getHistoryEntryOnchainMintAddress(historyEntry);
}

export function matchesTransactionPaymentType(
  historyEntry: HistoryEntry,
  paymentType: TransactionPaymentType,
): boolean {
  if (paymentType === "all") return true;
  if (paymentType === "onchain") return isOnchainHistoryEntry(historyEntry);
  if (paymentType === "lightning") {
    if (historyEntry.type === "melt") return true;
    return historyEntry.type === "mint" && !isOnchainHistoryEntry(historyEntry);
  }
  return historyEntry.type === "send" || historyEntry.type === "receive";
}

export function matchesTransactionDirection(
  historyEntry: HistoryEntry,
  direction: TransactionDirection,
): boolean {
  return direction === "all"
    ? true
    : direction === "incoming"
      ? historyEntry.type === "mint" || historyEntry.type === "receive"
      : historyEntry.type === "send" || historyEntry.type === "melt";
}

export function matchesTransactionFilters(
  historyEntry: HistoryEntry,
  {
    paymentType,
    direction,
  }: {
    paymentType: TransactionPaymentType;
    direction: TransactionDirection;
  },
): boolean {
  return (
    matchesTransactionPaymentType(historyEntry, paymentType) &&
    matchesTransactionDirection(historyEntry, direction)
  );
}

export function isPendingTransaction(
  historyEntry: HistoryEntry,
  options: { isCollapsingGhost?: boolean } = {},
): boolean {
  if (options.isCollapsingGhost) return true;

  if (historyEntry.type === "mint") {
    const state = String(historyEntry.state).toLowerCase();
    if (isOnchainHistoryEntry(historyEntry)) {
      return state === "pending" || state === "executing" || state === "unpaid";
    }
    return state === "unpaid";
  }
  if (historyEntry.type === "melt") {
    return String(historyEntry.state).toLowerCase() === "unpaid";
  }
  // A receive in `executing` state is a received-but-not-yet-redeemed token
  // (e.g. a P2PK token accepted while the mint was unreachable). It is not
  // yet in spendable balance, so it belongs in the pending section.
  return (
    isCancellablePendingEcash(historyEntry) ||
    (historyEntry.type === "receive" && isReceiveTokenPending(historyEntry))
  );
}

/**
 * True when an entry is an unpaid Lightning/onchain mint quote whose invoice
 * has expired. Used to bucket it under Expired instead of Pending.
 */
export function isMintExpired(historyEntry: HistoryEntry): boolean {
  if (historyEntry.type !== "mint") return false;
  if (String(historyEntry.state).toUpperCase() !== "UNPAID") return false;
  return mintHistoryEntryExpired(
    historyEntry as Extract<HistoryEntry, { type: "mint" }>,
  );
}

/**
 * Single source of truth for which section a history entry renders in.
 * Expired wins over pending; everything else is confirmed.
 */
export function bucketTransaction(
  historyEntry: HistoryEntry,
  options: { isCollapsingGhost?: boolean } = {},
): TransactionBucket {
  if (isMintExpired(historyEntry)) return "expired";
  if (isPendingTransaction(historyEntry, options)) return "pending";
  return "confirmed";
}
