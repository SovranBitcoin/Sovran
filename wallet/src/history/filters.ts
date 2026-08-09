import type { HistoryEntry, SendHistoryEntry } from "@cashu/coco-core";

import { getOnchainMelt } from "../annotations/selectors";
import {
  getHistoryEntryOnchainMeltAddress,
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
    ? // A receive counts as received money only once the token actually
      // redeemed (finalized). `executing` entries are received-but-
      // unredeemed (not yet in spendable balance) and `rolled_back` entries
      // are failed/already-spent token attempts — counting either inflates
      // "Received this month" with money that never arrived (BTC-11).
      isReceiveTokenRedeemed(historyEntry)
    : historyEntry.type === "mint"
      ? // A mint quote (Lightning / bolt12 / onchain deposit) counts as received
        // once the mint has observed the payment. This spans BOTH the transient
        // legacy `PAID` (v2 `executing`, minting) and the terminal `ISSUED` (v2
        // `finalized`, ecash credited) — matching `isMintQuotePaymentObserved`.
        // Matching only `PAID` dropped every fully-credited deposit (which ends
        // at `ISSUED`) from "Received this month".
        isMintQuotePaymentObserved(historyEntry)
      : false;
}

export function isOnchainHistoryEntry(historyEntry: HistoryEntry): boolean {
  if (historyEntry.type === "mint") {
    return !!getHistoryEntryOnchainMintAddress(historyEntry);
  }
  if (historyEntry.type === "melt") {
    // Fresh/synthetic melt entries carry `method: 'onchain'` in metadata;
    // persisted coco melt rows carry NO metadata, so the merged onchainMelt
    // annotation (outpoint/fee/address, written by the onchain send flow) is
    // the durable signal. Pre-annotation historical rows stay undetectable.
    return (
      !!getHistoryEntryOnchainMeltAddress(historyEntry) ||
      getOnchainMelt(historyEntry) !== null
    );
  }
  return false;
}

export function matchesTransactionPaymentType(
  historyEntry: HistoryEntry,
  paymentType: TransactionPaymentType,
): boolean {
  if (paymentType === "all") return true;
  if (paymentType === "onchain") return isOnchainHistoryEntry(historyEntry);
  if (paymentType === "lightning") {
    if (historyEntry.type === "melt") return !isOnchainHistoryEntry(historyEntry);
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
    // In-flight melts belong in Pending too: an onchain send can sit PENDING
    // for an hour awaiting confirmations. Covers both the legacy vocabulary
    // (UNPAID/PENDING) and raw v2 op states (prepared/pending/executing) like
    // the mint branch above; terminal failures are excluded.
    const state = String(historyEntry.state).toLowerCase();
    return (
      state === "unpaid" ||
      state === "prepared" ||
      state === "pending" ||
      state === "executing"
    );
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
