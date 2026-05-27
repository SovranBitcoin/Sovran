import type { HistoryEntry } from '@cashu/coco-core';
import { isMintQuotePaymentObserved } from 'colada';
import type { MempoolAddressSummary } from 'colada';

import {
  getMintQuoteRouteTitle,
  getReceiveQuoteScreenTitle,
  getOnchainStatusProgress,
} from '@/features/receive/lib/mintQuotePresentation';
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

  it('titles onchain mint quotes separately from Lightning quotes', () => {
    expect(getReceiveQuoteScreenTitle(true)).toBe('Receive Onchain');
    expect(getReceiveQuoteScreenTitle(false)).toBe('Receive Lightning');
  });

  it('derives the route title from serialized onchain mint quote entries', () => {
    const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';

    expect(
      getMintQuoteRouteTitle(
        JSON.stringify({
          type: 'mint',
          paymentRequest: address,
          metadata: { method: 'onchain', onchainAddress: address },
        })
      )
    ).toBe('Receive Onchain');

    expect(getMintQuoteRouteTitle(JSON.stringify({ type: 'mint', paymentRequest: 'lnbc1' }))).toBe(
      'Receive Lightning'
    );
  });

  it('derives the route title from BIP321 onchain paymentRequest values', () => {
    const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';

    expect(
      getMintQuoteRouteTitle(
        JSON.stringify({
          type: 'mint',
          paymentRequest: `bitcoin:${address}?amount=0.00001234`,
        })
      )
    ).toBe('Receive Onchain');
  });

  it('does not create onchain progress before payment is seen', () => {
    expect(getOnchainStatusProgress(null)).toBeNull();
    expect(getOnchainStatusProgress(emptySummary)).toBeNull();
  });

  it('derives compact onchain confirmation progress for the timeline', () => {
    expect(
      getOnchainStatusProgress({
        ...emptySummary,
        unconfirmedTxCount: 1,
        unconfirmedReceivedSats: 21,
        unconfirmedNetSats: 21,
        totalReceivedSats: 21,
      })
    ).toMatchObject({
      hasPayment: true,
      hasUnconfirmedPayment: true,
      currentConfirmations: null,
      requiredConfirmations: 6,
    });

    expect(
      getOnchainStatusProgress(
        {
          ...emptySummary,
          confirmedTxCount: 1,
          confirmedReceivedSats: 34,
          confirmedBalanceSats: 34,
          confirmedFundingConfirmations: 1,
          totalReceivedSats: 34,
        },
        6
      )
    ).toMatchObject({
      currentConfirmations: 1,
      requiredConfirmations: 6,
      isSatisfied: false,
    });

    expect(
      getOnchainStatusProgress(
        {
          ...emptySummary,
          confirmedTxCount: 1,
          confirmedReceivedSats: 34,
          confirmedBalanceSats: 34,
          confirmedFundingConfirmations: 8,
          totalReceivedSats: 34,
        },
        6
      )
    ).toMatchObject({
      currentConfirmations: 6,
      requiredConfirmations: 6,
      isSatisfied: true,
    });
  });

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
