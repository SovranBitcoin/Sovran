import type { MempoolAddressSummary } from '@/shared/lib/bitcoin/mempool';

export function getOnchainTransactionStatusLabel({
  summary,
  isLoading,
  error,
}: {
  summary: MempoolAddressSummary | null;
  isLoading: boolean;
  error: Error | null;
}): string | null {
  if (!summary) return isLoading ? 'Checking onchain' : error ? 'Onchain unavailable' : null;
  if (summary.unconfirmedTxCount > 0) {
    const suffix = summary.unconfirmedTxCount === 1 ? 'tx' : 'txs';
    return `${summary.unconfirmedTxCount} unconfirmed ${suffix}`;
  }
  if (summary.confirmedTxCount > 0) return 'Confirmed onchain';
  return null;
}
