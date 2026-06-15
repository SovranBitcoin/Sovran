import {
  createPaymentCopyResolver,
  type PaymentCopyKey,
  type PaymentCopyResolver,
} from "../copy";
import { logger } from "../logger";
import { isSendTokenCancelled, isSendTokenComplete } from "./filters";

export type SendTokenReachabilityStatus =
  | "checking"
  | "device-offline"
  | "mint-unreachable"
  | "mint-reachable";

export interface SendTokenWarningCopy {
  title: string;
  description: string;
}

interface SendTokenStateEntry {
  state?: unknown;
}

interface SendTokenWarningCopyKeys {
  title: PaymentCopyKey;
  description: PaymentCopyKey;
}

export interface SendTokenReachabilityWarningOptions {
  mintWasOffline?: boolean;
  reachabilityStatus?: SendTokenReachabilityStatus;
  paymentCopy?: PaymentCopyResolver;
}

const DEFAULT_PAYMENT_COPY = createPaymentCopyResolver();

const SEND_TOKEN_WARNING_COPY = {
  mintOffline: {
    title: "send.warning.mintOffline.title",
    description: "send.warning.mintOffline.description",
  },
  deviceOffline: {
    title: "send.warning.deviceOffline.title",
    description: "send.warning.deviceOffline.description",
  },
  mintUnreachable: {
    title: "send.warning.mintUnreachable.title",
    description: "send.warning.mintUnreachable.description",
  },
} as const satisfies Record<string, SendTokenWarningCopyKeys>;

function isActiveSendToken(
  entry: SendTokenStateEntry | null | undefined,
): boolean {
  if (!entry) return false;
  return !isSendTokenComplete(entry) && !isSendTokenCancelled(entry);
}

function summarizeState(
  entry: SendTokenStateEntry | null | undefined,
): string | null {
  if (!entry) return null;
  return typeof entry.state === "string" ? entry.state : typeof entry.state;
}

function buildWarningCopy(
  copyKeys: SendTokenWarningCopyKeys,
  paymentCopy: PaymentCopyResolver,
): SendTokenWarningCopy {
  return {
    title: paymentCopy.text(copyKeys.title),
    description: paymentCopy.text(copyKeys.description),
  };
}

export function shouldShowMintOfflineWarning(
  entry: SendTokenStateEntry | null | undefined,
  mintWasOffline: boolean | undefined,
): boolean {
  const active = isActiveSendToken(entry);
  const shouldShow = mintWasOffline === true && active;
  logger.debug("history.sendTokenWarning.mintOffline", {
    state: summarizeState(entry),
    mintWasOffline: mintWasOffline === true,
    active,
    shouldShow,
  });
  return shouldShow;
}

export function getSendTokenReachabilityWarning(
  entry: SendTokenStateEntry | null | undefined,
  options: SendTokenReachabilityWarningOptions,
): SendTokenWarningCopy | null {
  const paymentCopy = options.paymentCopy ?? DEFAULT_PAYMENT_COPY;

  if (shouldShowMintOfflineWarning(entry, options.mintWasOffline)) {
    logger.info("history.sendTokenWarning.result", {
      reason: "mint-offline",
      state: summarizeState(entry),
      reachabilityStatus: options.reachabilityStatus ?? null,
    });
    return buildWarningCopy(SEND_TOKEN_WARNING_COPY.mintOffline, paymentCopy);
  }

  if (!isActiveSendToken(entry)) {
    logger.debug("history.sendTokenWarning.result", {
      reason: "inactive",
      state: summarizeState(entry),
      reachabilityStatus: options.reachabilityStatus ?? null,
    });
    return null;
  }

  if (options.reachabilityStatus === "device-offline") {
    logger.info("history.sendTokenWarning.result", {
      reason: "device-offline",
      state: summarizeState(entry),
      reachabilityStatus: options.reachabilityStatus,
    });
    return buildWarningCopy(SEND_TOKEN_WARNING_COPY.deviceOffline, paymentCopy);
  }

  if (options.reachabilityStatus === "mint-unreachable") {
    logger.info("history.sendTokenWarning.result", {
      reason: "mint-unreachable",
      state: summarizeState(entry),
      reachabilityStatus: options.reachabilityStatus,
    });
    return buildWarningCopy(
      SEND_TOKEN_WARNING_COPY.mintUnreachable,
      paymentCopy,
    );
  }

  logger.debug("history.sendTokenWarning.result", {
    reason: "none",
    state: summarizeState(entry),
    reachabilityStatus: options.reachabilityStatus ?? null,
  });
  return null;
}
