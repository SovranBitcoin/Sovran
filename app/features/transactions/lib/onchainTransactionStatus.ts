import type { MempoolAddressSummary } from '@sovranbitcoin/colada';

import { cashuLog } from '@/shared/lib/logger';

export function getOnchainTransactionStatusLabel({
  summary,
  isLoading,
  error,
}: {
  summary: MempoolAddressSummary | null;
  isLoading: boolean;
  error: Error | null;
}): string | null {
  if (!summary) {
    const label = isLoading ? 'Checking onchain' : error ? 'Onchain unavailable' : null;
    cashuLog.debug('transactions.onchain_status.label', {
      reason: isLoading ? 'loading' : error ? 'error' : 'empty',
      label,
      hasSummary: false,
      hasError: !!error,
    });
    return label;
  }
  if (summary.unconfirmedTxCount > 0) {
    const suffix = summary.unconfirmedTxCount === 1 ? 'tx' : 'txs';
    const label = `${summary.unconfirmedTxCount} unconfirmed ${suffix}`;
    cashuLog.debug('transactions.onchain_status.label', {
      reason: 'unconfirmed',
      label,
      hasSummary: true,
      unconfirmedTxCount: summary.unconfirmedTxCount,
      confirmedTxCount: summary.confirmedTxCount,
    });
    return label;
  }
  if (summary.confirmedTxCount > 0) {
    const label = 'Confirmed onchain';
    cashuLog.debug('transactions.onchain_status.label', {
      reason: 'confirmed',
      label,
      hasSummary: true,
      unconfirmedTxCount: summary.unconfirmedTxCount,
      confirmedTxCount: summary.confirmedTxCount,
    });
    return label;
  }
  cashuLog.debug('transactions.onchain_status.label', {
    reason: 'no-transactions',
    label: null,
    hasSummary: true,
    unconfirmedTxCount: summary.unconfirmedTxCount,
    confirmedTxCount: summary.confirmedTxCount,
  });
  return null;
}
