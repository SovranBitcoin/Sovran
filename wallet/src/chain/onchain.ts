import type { ChainAddressSummary } from "../adapters";
import { logger } from "../logger";

export const DEFAULT_ONCHAIN_REQUIRED_CONFIRMATIONS = 6;

export interface OnchainConfirmationProgress {
  hasPayment: boolean;
  hasUnconfirmedPayment: boolean;
  receivedSats: number;
  currentConfirmations: number | null;
  requiredConfirmations: number;
  isSatisfied: boolean;
}

export function getOnchainConfirmationProgress(
  summary: ChainAddressSummary | null | undefined,
  requiredConfirmations = DEFAULT_ONCHAIN_REQUIRED_CONFIRMATIONS,
): OnchainConfirmationProgress | null {
  if (!summary) {
    logger.debug("chain.onchain.confirmationProgress.result", {
      reason: "missing-summary",
      requiredConfirmations,
    });
    return null;
  }

  const normalizedRequired =
    Number.isSafeInteger(requiredConfirmations) && requiredConfirmations > 0
      ? requiredConfirmations
      : DEFAULT_ONCHAIN_REQUIRED_CONFIRMATIONS;
  const receivedSats = summary.totalReceivedSats;
  const hasUnconfirmedPayment = summary.unconfirmedTxCount > 0;
  const hasConfirmedPayment = summary.confirmedTxCount > 0;

  if (!hasUnconfirmedPayment && !hasConfirmedPayment) {
    logger.debug("chain.onchain.confirmationProgress.result", {
      reason: "no-payment",
      requiredConfirmations: normalizedRequired,
      unconfirmedTxCount: summary.unconfirmedTxCount,
      confirmedTxCount: summary.confirmedTxCount,
    });
    return null;
  }

  const currentConfirmations = hasConfirmedPayment
    ? summary.confirmedFundingConfirmations
    : null;
  const cappedConfirmations =
    currentConfirmations == null
      ? null
      : Math.min(currentConfirmations, normalizedRequired);

  const progress = {
    hasPayment: true,
    hasUnconfirmedPayment,
    receivedSats,
    currentConfirmations: cappedConfirmations,
    requiredConfirmations: normalizedRequired,
    isSatisfied:
      currentConfirmations != null &&
      currentConfirmations >= normalizedRequired,
  };
  logger.info("chain.onchain.confirmationProgress.result", {
    reason: progress.isSatisfied ? "satisfied" : "waiting",
    hasUnconfirmedPayment,
    receivedSats,
    currentConfirmations: cappedConfirmations,
    requiredConfirmations: normalizedRequired,
    isSatisfied: progress.isSatisfied,
  });
  return progress;
}

export function getOnchainConfirmationInfo(
  progress: OnchainConfirmationProgress,
): string {
  if (progress.hasUnconfirmedPayment && progress.currentConfirmations == null) {
    logger.debug("chain.onchain.confirmationInfo.result", {
      reason: "waiting-first-confirmation",
      hasUnconfirmedPayment: progress.hasUnconfirmedPayment,
      currentConfirmations: progress.currentConfirmations,
      requiredConfirmations: progress.requiredConfirmations,
      isSatisfied: progress.isSatisfied,
    });
    return "Waiting for first confirmation";
  }

  if (progress.currentConfirmations == null) {
    logger.debug("chain.onchain.confirmationInfo.result", {
      reason: "confirmed-no-count",
      hasUnconfirmedPayment: progress.hasUnconfirmedPayment,
      currentConfirmations: progress.currentConfirmations,
      requiredConfirmations: progress.requiredConfirmations,
      isSatisfied: progress.isSatisfied,
    });
    return "Payment confirmed onchain";
  }

  logger.debug("chain.onchain.confirmationInfo.result", {
    reason: "counted-confirmations",
    hasUnconfirmedPayment: progress.hasUnconfirmedPayment,
    currentConfirmations: progress.currentConfirmations,
    requiredConfirmations: progress.requiredConfirmations,
    isSatisfied: progress.isSatisfied,
  });
  return `${progress.currentConfirmations}/${progress.requiredConfirmations} confirmations`;
}
