import type { ChainAddressSummary } from '../adapters';

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
  if (!summary) return null;

  const normalizedRequired =
    Number.isSafeInteger(requiredConfirmations) && requiredConfirmations > 0
      ? requiredConfirmations
      : DEFAULT_ONCHAIN_REQUIRED_CONFIRMATIONS;
  const receivedSats = summary.totalReceivedSats;
  const hasUnconfirmedPayment = summary.unconfirmedTxCount > 0;
  const hasConfirmedPayment = summary.confirmedTxCount > 0;

  if (!hasUnconfirmedPayment && !hasConfirmedPayment) {
    return null;
  }

  const currentConfirmations = hasConfirmedPayment ? summary.confirmedFundingConfirmations : null;
  const cappedConfirmations =
    currentConfirmations == null ? null : Math.min(currentConfirmations, normalizedRequired);

  return {
    hasPayment: true,
    hasUnconfirmedPayment,
    receivedSats,
    currentConfirmations: cappedConfirmations,
    requiredConfirmations: normalizedRequired,
    isSatisfied: currentConfirmations != null && currentConfirmations >= normalizedRequired,
  };
}

export function getOnchainConfirmationInfo(progress: OnchainConfirmationProgress): string {
  if (progress.hasUnconfirmedPayment && progress.currentConfirmations == null) {
    return 'Waiting for first confirmation';
  }

  if (progress.currentConfirmations == null) {
    return 'Payment confirmed onchain';
  }

  return `${progress.currentConfirmations}/${progress.requiredConfirmations} confirmations`;
}
