import { getOnchainTransactionStatusLabel } from '@/features/transactions/lib/onchainTransactionStatus';
import type { MempoolAddressSummary } from 'colada';

const emptySummary: MempoolAddressSummary = {
  address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080',
  confirmedTxCount: 0,
  confirmedReceivedSats: 0,
  confirmedBalanceSats: 0,
  confirmedFundingConfirmations: null,
  unconfirmedTxCount: 0,
  unconfirmedReceivedSats: 0,
  unconfirmedNetSats: 0,
  totalReceivedSats: 0,
  explorerUrl: 'https://mempool.space/address/bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080',
};

describe('getOnchainTransactionStatusLabel', () => {
  it('omits empty onchain status after a zero-activity lookup resolves', () => {
    expect(
      getOnchainTransactionStatusLabel({
        summary: emptySummary,
        isLoading: false,
        error: null,
      })
    ).toBeNull();
  });

  it('keeps actionable onchain status states', () => {
    expect(
      getOnchainTransactionStatusLabel({
        summary: null,
        isLoading: true,
        error: null,
      })
    ).toBe('Checking onchain');

    expect(
      getOnchainTransactionStatusLabel({
        summary: {
          ...emptySummary,
          unconfirmedTxCount: 2,
        },
        isLoading: false,
        error: null,
      })
    ).toBe('2 unconfirmed txs');

    expect(
      getOnchainTransactionStatusLabel({
        summary: {
          ...emptySummary,
          confirmedTxCount: 1,
        },
        isLoading: false,
        error: null,
      })
    ).toBe('Confirmed onchain');
  });
});
