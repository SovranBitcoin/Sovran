import type { MempoolAddressSummary } from 'wallet';

import { isOnchainReceiveSettled } from '@/shared/lib/cashu/onchainMint';

jest.mock('@/shared/lib/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { cashuLog: log, log };
});

const confirmed: MempoolAddressSummary = {
  address: 'bc1qfixture',
  confirmedTxCount: 1,
  confirmedReceivedSats: 5_000,
  confirmedBalanceSats: 5_000,
  confirmedFundingConfirmations: 3,
  unconfirmedTxCount: 0,
  unconfirmedReceivedSats: 0,
  unconfirmedNetSats: 0,
  totalReceivedSats: 5_000,
  explorerUrl: 'https://mempool.space/address/bc1qfixture',
  transactionExplorerUrl: null,
};

describe('isOnchainReceiveSettled', () => {
  // Coco's mint operation is `executing` from before the mint is asked to
  // issue until the ecash is stored (coco MintOperationService.ts:279), so
  // the page keeps watching until the operation is finalized.
  it('keeps watching while the mint operation is executing, confirmations or not', () => {
    expect(isOnchainReceiveSettled({ state: 'executing' }, confirmed, 2)).toBe(false);
    expect(isOnchainReceiveSettled({ state: 'PAID' }, confirmed, 2)).toBe(false);
  });

  it('is settled once the ecash is credited and the deposit has the confirmations', () => {
    expect(isOnchainReceiveSettled({ state: 'finalized' }, confirmed, 2)).toBe(true);
    expect(isOnchainReceiveSettled({ state: 'ISSUED' }, confirmed, 2)).toBe(true);
  });

  it('keeps watching a credited receive until the deposit has the confirmations', () => {
    expect(isOnchainReceiveSettled({ state: 'finalized' }, confirmed, 6)).toBe(false);
    expect(isOnchainReceiveSettled({ state: 'finalized' }, null, 2)).toBe(false);
  });
});
