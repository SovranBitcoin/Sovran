import type { HistoryEntry, SendHistoryEntry } from "@cashu/coco-core";

import { logger } from "../logger";
import {
  getHistoryEntryOnchainMintAddress,
  mintHistoryEntryExpired,
} from "./timeline";

export type TransactionPaymentType = "all" | "lightning" | "ecash" | "onchain";
export type TransactionDirection = "all" | "incoming" | "outgoing";

/** Which list section a history entry belongs to. */
export type TransactionBucket = "pending" | "confirmed" | "expired";

const CANCELLABLE_SEND_STATES = new Set(["pending", "prepared"]);

export function isCancellablePendingEcash(
  entry: HistoryEntry,
): entry is SendHistoryEntry {
  const state = String((entry as SendHistoryEntry).state ?? "");
  const result = entry.type === "send" && CANCELLABLE_SEND_STATES.has(state);
  logger.debug("history.filters.cancellablePendingEcash", {
    type: entry.type,
    state,
    result,
  });
  return result;
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
  const result =
    state === "executing" ||
    state === "finalized" ||
    state === "PAID" ||
    state === "ISSUED" ||
    entry?.remoteState === "ISSUED" ||
    entry?.remoteState === "PAID";
  logger.debug("history.filters.mintQuotePaymentObserved", {
    state,
    remoteState: entry?.remoteState ?? null,
    result,
  });
  return result;
}

export function isMeltQuotePaid(
  entry: { state?: unknown } | null | undefined,
): boolean {
  const state = String(entry?.state ?? "");
  const result = state === "finalized" || state === "PAID";
  logger.debug("history.filters.meltQuotePaid", { state, result });
  return result;
}

export function isMeltQuoteReadyToPay(
  entry: { state?: unknown } | null | undefined,
): boolean {
  const state = String(entry?.state ?? "");
  const result = state === "prepared" || state === "UNPAID";
  logger.debug("history.filters.meltQuoteReadyToPay", { state, result });
  return result;
}

export function isReceiveTokenRedeemed(
  entry: { state?: unknown } | null | undefined,
): boolean {
  const result = entry?.state === "finalized";
  logger.debug("history.filters.receiveTokenRedeemed", {
    state: String(entry?.state ?? ""),
    result,
  });
  return result;
}

export function isReceiveTokenPending(
  entry: { state?: unknown } | null | undefined,
): boolean {
  const result = entry?.state === "executing";
  logger.debug("history.filters.receiveTokenPending", {
    state: String(entry?.state ?? ""),
    result,
  });
  return result;
}

export function isSendTokenComplete(
  entry: { state?: unknown } | null | undefined,
): boolean {
  const result = entry?.state === "finalized";
  logger.debug("history.filters.sendTokenComplete", {
    state: String(entry?.state ?? ""),
    result,
  });
  return result;
}

export function isSendTokenCancelled(
  entry: { state?: unknown } | null | undefined,
): boolean {
  const state = String(entry?.state ?? "");
  const result = state === "rolledBack" || state === "rolled_back";
  logger.debug("history.filters.sendTokenCancelled", { state, result });
  return result;
}

export function isSettledSpendHistoryEntry(
  historyEntry: HistoryEntry,
): boolean {
  const result =
    historyEntry.type === "send"
      ? isSendTokenComplete(historyEntry)
      : historyEntry.type === "melt"
        ? isMeltQuotePaid(historyEntry)
        : false;
  logger.debug("history.filters.settledSpend", {
    type: historyEntry.type,
    state: String((historyEntry as Record<string, unknown>).state ?? ""),
    result,
  });
  return result;
}

export function isSettledReceiveHistoryEntry(
  historyEntry: HistoryEntry,
): boolean {
  const result =
    historyEntry.type === "receive"
      ? true
      : historyEntry.type === "mint"
        ? String(historyEntry.state) === "PAID"
        : false;
  logger.debug("history.filters.settledReceive", {
    type: historyEntry.type,
    state: String((historyEntry as Record<string, unknown>).state ?? ""),
    result,
  });
  return result;
}

export function isOnchainHistoryEntry(historyEntry: HistoryEntry): boolean {
  const result = !!getHistoryEntryOnchainMintAddress(historyEntry);
  logger.debug("history.filters.onchainHistoryEntry", {
    type: historyEntry.type,
    state: String((historyEntry as Record<string, unknown>).state ?? ""),
    result,
  });
  return result;
}

export function matchesTransactionPaymentType(
  historyEntry: HistoryEntry,
  paymentType: TransactionPaymentType,
): boolean {
  let result: boolean;
  if (paymentType === "all") {
    result = true;
  } else if (paymentType === "onchain") {
    result = isOnchainHistoryEntry(historyEntry);
  } else if (paymentType === "lightning") {
    if (historyEntry.type === "melt") result = true;
    else
      result =
        historyEntry.type === "mint" && !isOnchainHistoryEntry(historyEntry);
  } else {
    result = historyEntry.type === "send" || historyEntry.type === "receive";
  }

  logger.debug("history.filters.matchesPaymentType", {
    type: historyEntry.type,
    state: String((historyEntry as Record<string, unknown>).state ?? ""),
    paymentType,
    result,
  });
  return result;
}

export function matchesTransactionDirection(
  historyEntry: HistoryEntry,
  direction: TransactionDirection,
): boolean {
  const result =
    direction === "all"
      ? true
      : direction === "incoming"
        ? historyEntry.type === "mint" || historyEntry.type === "receive"
        : historyEntry.type === "send" || historyEntry.type === "melt";
  logger.debug("history.filters.matchesDirection", {
    type: historyEntry.type,
    state: String((historyEntry as Record<string, unknown>).state ?? ""),
    direction,
    result,
  });
  return result;
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
  const matchesPaymentType = matchesTransactionPaymentType(
    historyEntry,
    paymentType,
  );
  const matchesDirection = matchesTransactionDirection(historyEntry, direction);
  const result = matchesPaymentType && matchesDirection;
  logger.debug("history.filters.matchesFilters", {
    type: historyEntry.type,
    state: String((historyEntry as Record<string, unknown>).state ?? ""),
    paymentType,
    direction,
    matchesPaymentType,
    matchesDirection,
    result,
  });
  return result;
}

export function isPendingTransaction(
  historyEntry: HistoryEntry,
  options: { isCollapsingGhost?: boolean } = {},
): boolean {
  if (options.isCollapsingGhost) {
    logger.debug("history.filters.pendingTransaction", {
      type: historyEntry.type,
      state: String((historyEntry as Record<string, unknown>).state ?? ""),
      reason: "collapsing-ghost",
      result: true,
    });
    return true;
  }

  let result: boolean;
  let reason: string;
  if (historyEntry.type === "mint") {
    const state = String(historyEntry.state).toLowerCase();
    if (isOnchainHistoryEntry(historyEntry)) {
      result =
        state === "pending" || state === "executing" || state === "unpaid";
      reason = "onchain-mint";
    } else {
      result = state === "unpaid";
      reason = "lightning-mint";
    }
  } else if (historyEntry.type === "melt") {
    result = String(historyEntry.state).toLowerCase() === "unpaid";
    reason = "melt";
  } else {
    // A receive in `executing` state is a received-but-not-yet-redeemed token
    // (e.g. a P2PK token accepted while the mint was unreachable). It is not
    // yet in spendable balance, so it belongs in the pending section.
    result =
      isCancellablePendingEcash(historyEntry) ||
      (historyEntry.type === "receive" && isReceiveTokenPending(historyEntry));
    reason = "ecash";
  }

  logger.debug("history.filters.pendingTransaction", {
    type: historyEntry.type,
    state: String((historyEntry as Record<string, unknown>).state ?? ""),
    reason,
    result,
  });
  return result;
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
