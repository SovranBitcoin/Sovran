import type { HistoryEntry, SendHistoryEntry } from "@cashu/coco-core";

import { logger } from "../logger";
import { getHistoryEntryOnchainMintAddress } from "./timeline";

export type TransactionPaymentType = "all" | "lightning" | "ecash" | "onchain";
export type TransactionDirection = "all" | "incoming" | "outgoing";

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
    result = isCancellablePendingEcash(historyEntry);
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
