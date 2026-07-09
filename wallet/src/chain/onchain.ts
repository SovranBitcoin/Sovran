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

/** Split a coco onchain-melt `outpoint` ("txid:vout") into its parts, or null
 *  when absent/malformed. The `vout` pins the exact output paying the recipient
 *  (mints may batch), and `txid` links straight to a block explorer. */
export function parseOutpoint(
  outpoint: string | null | undefined,
): { txid: string; vout: number } | null {
  if (!outpoint) return null;
  const idx = outpoint.lastIndexOf(":");
  if (idx <= 0) return null;
  const txid = outpoint.slice(0, idx).trim().toLowerCase();
  const vout = Number(outpoint.slice(idx + 1).trim());
  if (!/^[0-9a-f]{64}$/.test(txid) || !Number.isInteger(vout) || vout < 0) {
    logger.debug("chain.onchain.parseOutpoint.result", { reason: "malformed" });
    return null;
  }
  return { txid, vout };
}

/**
 * Confirmation progress for a KNOWN transaction (onchain SEND) — parallel to
 * `getOnchainConfirmationProgress` but keyed off a single tx status
 * (`getTransactionStatus(txid)`) instead of an address summary. `confirmations`
 * is 0 while the tx sits in the mempool, ≥1 once mined. Returns null when the
 * tx isn't observable yet (no txid / not broadcast).
 */
export function buildOnchainConfirmationProgressFromTx(
  status: { confirmed: boolean; confirmations: number } | null | undefined,
  requiredConfirmations = DEFAULT_ONCHAIN_REQUIRED_CONFIRMATIONS,
): OnchainConfirmationProgress | null {
  if (!status) {
    logger.debug("chain.onchain.confirmationProgressFromTx.result", {
      reason: "no-tx-status",
      requiredConfirmations,
    });
    return null;
  }
  const normalizedRequired =
    Number.isSafeInteger(requiredConfirmations) && requiredConfirmations > 0
      ? requiredConfirmations
      : DEFAULT_ONCHAIN_REQUIRED_CONFIRMATIONS;
  const confirmed = status.confirmed && status.confirmations >= 1;
  const currentConfirmations = confirmed
    ? Math.min(status.confirmations, normalizedRequired)
    : null;
  const progress = {
    hasPayment: true,
    // In the mempool with 0 confirmations counts as an unconfirmed payment, so
    // the timeline shows "Waiting for first confirmation".
    hasUnconfirmedPayment: !confirmed,
    receivedSats: 0, // not tracked per-tx; unused by the send timeline info
    currentConfirmations,
    requiredConfirmations: normalizedRequired,
    isSatisfied: confirmed && status.confirmations >= normalizedRequired,
  };
  logger.info("chain.onchain.confirmationProgressFromTx.result", {
    reason: progress.isSatisfied ? "satisfied" : "waiting",
    confirmed,
    currentConfirmations,
    requiredConfirmations: normalizedRequired,
  });
  return progress;
}

/**
 * Whether a tx-status poller can stop: the tx is mined AND has reached the
 * required depth. The UI caps its display at the required count, so further
 * polling can never change what's rendered. Deliberately ignores the mint's
 * own PAID flag — the ring is driven by OUR observed count, which may lag the
 * mint's threshold, and must keep counting until it catches up.
 */
export function shouldStopTxConfirmationPolling(
  status: { confirmed: boolean; confirmations: number } | null | undefined,
  requiredConfirmations = DEFAULT_ONCHAIN_REQUIRED_CONFIRMATIONS,
): boolean {
  if (!status?.confirmed) return false;
  const normalizedRequired =
    Number.isSafeInteger(requiredConfirmations) && requiredConfirmations > 0
      ? requiredConfirmations
      : DEFAULT_ONCHAIN_REQUIRED_CONFIRMATIONS;
  return status.confirmations >= normalizedRequired;
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
