import type { HistoryEntry } from '@cashu/coco-core';

import {
  isPendingTransaction,
  matchesTransactionFilters,
  matchesTransactionPaymentType,
} from '@sovranbitcoin/colada';

const ONCHAIN_ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';

const baseFields = {
  id: 'h1',
  source: 'operation' as const,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  mintUrl: 'https://mint.example',
  unit: 'sat',
  amount: 100,
};

function entry(overrides: Record<string, unknown>): HistoryEntry {
  return {
    ...baseFields,
    ...overrides,
  } as unknown as HistoryEntry;
}

describe('transaction history filters', () => {
  it('classifies operation-backed onchain receives separately from Lightning', () => {
    const onchainMint = entry({
      type: 'mint',
      operationId: 'op1',
      quoteId: 'q1',
      state: 'pending',
      paymentRequest: ONCHAIN_ADDRESS,
      metadata: {
        method: 'onchain',
        onchainAddress: ONCHAIN_ADDRESS,
      },
    });

    expect(matchesTransactionPaymentType(onchainMint, 'onchain')).toBe(true);
    expect(matchesTransactionPaymentType(onchainMint, 'lightning')).toBe(false);
    expect(
      matchesTransactionFilters(onchainMint, { paymentType: 'onchain', direction: 'all' })
    ).toBe(true);
    expect(
      matchesTransactionFilters(onchainMint, { paymentType: 'onchain', direction: 'incoming' })
    ).toBe(true);
    expect(
      matchesTransactionFilters(onchainMint, { paymentType: 'onchain', direction: 'outgoing' })
    ).toBe(false);
  });

  it('keeps Lightning and ecash buckets unchanged for non-onchain entries', () => {
    const lightningMint = entry({
      type: 'mint',
      quoteId: 'q-lightning',
      state: 'UNPAID',
      paymentRequest: 'lnbc1invoice',
    });
    const lightningMelt = entry({
      type: 'melt',
      quoteId: 'q-melt',
      state: 'UNPAID',
    });
    const ecashSend = entry({
      type: 'send',
      operationId: 'op-send',
      state: 'prepared',
    });

    expect(matchesTransactionPaymentType(lightningMint, 'lightning')).toBe(true);
    expect(matchesTransactionPaymentType(lightningMelt, 'lightning')).toBe(true);
    expect(matchesTransactionPaymentType(ecashSend, 'ecash')).toBe(true);
    expect(matchesTransactionPaymentType(ecashSend, 'lightning')).toBe(false);
  });

  it('treats pending and executing onchain mint operations as pending history rows', () => {
    const makeOnchainMint = (state: string) =>
      entry({
        type: 'mint',
        operationId: `op-${state}`,
        quoteId: `q-${state}`,
        state,
        paymentRequest: ONCHAIN_ADDRESS,
        metadata: {
          method: 'onchain',
          onchainAddress: ONCHAIN_ADDRESS,
        },
      });

    expect(isPendingTransaction(makeOnchainMint('pending'))).toBe(true);
    expect(isPendingTransaction(makeOnchainMint('executing'))).toBe(true);
    expect(isPendingTransaction(makeOnchainMint('finalized'))).toBe(false);
  });
});
