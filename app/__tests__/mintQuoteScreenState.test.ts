import type { HistoryEntry } from '@cashu/coco-core';
import { isMintQuotePaymentObserved } from 'wallet';

import {
  getMintQuotePaymentValue,
  getOnchainMintQuoteRequiredConfirmations,
  getOnchainRequiredConfirmations,
} from '@/shared/lib/cashu/onchainMint';

describe('isMintQuotePaymentObserved', () => {
  it('treats Coco operation executing and finalized states as payment observed', () => {
    expect(isMintQuotePaymentObserved({ state: 'executing' })).toBe(true);
    expect(isMintQuotePaymentObserved({ state: 'finalized' })).toBe(true);
  });

  it('treats legacy remote PAID and ISSUED states as payment observed', () => {
    expect(isMintQuotePaymentObserved({ state: 'pending', remoteState: 'PAID' })).toBe(true);
    expect(isMintQuotePaymentObserved({ state: 'pending', remoteState: 'ISSUED' })).toBe(true);
    expect(isMintQuotePaymentObserved({ state: 'ISSUED' })).toBe(true);
  });

  it('keeps pending and failed states in the waiting state', () => {
    expect(isMintQuotePaymentObserved({ state: 'pending' })).toBe(false);
    expect(isMintQuotePaymentObserved({ state: 'failed' })).toBe(false);
    expect(isMintQuotePaymentObserved(null)).toBe(false);
  });
});

describe('mint quote screen presentation', () => {
  it('encodes onchain mint quotes as BIP321 with the requested amount', () => {
    const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';

    expect(
      getMintQuotePaymentValue({
        type: 'mint',
        paymentRequest: address,
        amount: 0,
        unit: 'sat',
        metadata: {
          method: 'onchain',
          onchainAddress: address,
          requestedAmount: '1234',
          memo: 'For coffee',
        },
      } as unknown as HistoryEntry)
    ).toBe(`bitcoin:${address}?amount=0.00001234&message=For%20coffee`);

    expect(
      getMintQuotePaymentValue({
        type: 'mint',
        paymentRequest: 'lnbc1invoice',
        amount: 1234,
        unit: 'sat',
      } as unknown as HistoryEntry)
    ).toBe('lnbc1invoice');
  });

  it('reads onchain confirmation requirements from NUT-04 mint info', () => {
    expect(
      getOnchainRequiredConfirmations({
        nuts: {
          '4': {
            methods: [
              { method: 'bolt11', unit: 'sat' },
              { method: 'onchain', unit: 'sat', options: { confirmations: 3 } },
            ],
          },
        },
      })
    ).toBe(3);

    expect(getOnchainRequiredConfirmations({ nuts: { '4': { methods: [] } } })).toBe(6);
  });

  it('prefers quote metadata confirmations before falling back to NUT-04 mint info', () => {
    const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
    const mintInfo = {
      nuts: {
        '4': {
          methods: [{ method: 'onchain', unit: 'sat', options: { confirmations: 6 } }],
        },
      },
    };

    expect(
      getOnchainMintQuoteRequiredConfirmations(
        {
          type: 'mint',
          paymentRequest: address,
          unit: 'sat',
          metadata: {
            method: 'onchain',
            onchainAddress: address,
            requiredConfirmations: '2',
          },
        } as unknown as HistoryEntry,
        mintInfo
      )
    ).toBe(2);

    expect(
      getOnchainMintQuoteRequiredConfirmations(
        {
          type: 'mint',
          paymentRequest: address,
          unit: 'sat',
          metadata: { method: 'onchain', onchainAddress: address },
        } as unknown as HistoryEntry,
        mintInfo
      )
    ).toBe(6);
  });
});
