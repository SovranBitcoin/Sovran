import {
  createPaymentCopyResolver,
  type PaymentCopyKey,
  type PaymentCopyResolver,
} from "../copy";
import { logger } from "../logger";
import { isReceiveTokenRedeemed, isSendTokenComplete } from "./filters";

interface RefreshHistoryEntry {
  type: "send" | "receive" | string;
  state?: unknown;
}

const DEFAULT_PAYMENT_COPY = createPaymentCopyResolver();

export function getHistoryEntryRefreshLabel(
  historyEntry: RefreshHistoryEntry,
  paymentCopy: PaymentCopyResolver = DEFAULT_PAYMENT_COPY,
): string {
  let key: PaymentCopyKey;

  if (historyEntry.type === "send") {
    const complete = isSendTokenComplete(historyEntry);
    key = complete ? "history.refresh.sentWith" : "history.refresh.sendingWith";
    logger.debug("history.refresh.label", {
      type: historyEntry.type,
      state:
        typeof historyEntry.state === "string"
          ? historyEntry.state
          : typeof historyEntry.state,
      complete,
      key,
    });
    return paymentCopy.text(key);
  }

  if (historyEntry.type === "receive") {
    const redeemed = isReceiveTokenRedeemed(historyEntry);
    key = redeemed
      ? "history.refresh.receivedWith"
      : "history.refresh.receivingWith";
    logger.debug("history.refresh.label", {
      type: historyEntry.type,
      state:
        typeof historyEntry.state === "string"
          ? historyEntry.state
          : typeof historyEntry.state,
      redeemed,
      key,
    });
    return paymentCopy.text(key);
  }

  key = "history.refresh.processingWith";
  logger.debug("history.refresh.label", {
    type: historyEntry.type,
    state:
      typeof historyEntry.state === "string"
        ? historyEntry.state
        : typeof historyEntry.state,
    key,
  });
  return paymentCopy.text(key);
}
