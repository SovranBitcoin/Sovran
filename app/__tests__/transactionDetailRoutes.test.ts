import type { HistoryEntry } from '@cashu/coco-core';

import {
  getMeltDetailPathname,
  getMintDetailPathname,
  navigateToTransactionDetail,
} from '@/shared/lib/nav/transactionDetailRoutes';
import { guardedRouter } from '@/shared/hooks/useGuardedRouter';

jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { navigate: jest.fn() },
}));

const navigate = guardedRouter.navigate as jest.Mock;

describe('transaction detail routes', () => {
  it('routes mint entries to Lightning receive by default', () => {
    expect(
      getMintDetailPathname({
        type: 'mint',
        paymentRequest: 'lnbc1invoice',
      } as unknown as HistoryEntry)
    ).toBe('/lightningReceive');
  });

  it('routes onchain mint entries to Onchain receive', () => {
    const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';

    expect(
      getMintDetailPathname({
        type: 'mint',
        paymentRequest: address,
        metadata: { method: 'onchain', onchainAddress: address },
      } as unknown as HistoryEntry)
    ).toBe('/onchainReceive');
  });

  it('routes melt entries to Lightning send by default', () => {
    expect(
      getMeltDetailPathname({
        type: 'melt',
        metadata: { method: 'bolt11', meltTarget: 'lnbc1invoice' },
      } as unknown as HistoryEntry)
    ).toBe('/lightningSend');
  });

  it('routes onchain melt entries to Onchain send', () => {
    const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';

    expect(
      getMeltDetailPathname({
        type: 'melt',
        metadata: { method: 'onchain', onchainAddress: address },
      } as unknown as HistoryEntry)
    ).toBe('/onchainSend');
  });
});

describe('navigateToTransactionDetail (history view tagging)', () => {
  beforeEach(() => navigate.mockClear());

  const cases = [
    {
      name: 'lightning mint',
      entry: { type: 'mint', paymentRequest: 'lnbc1invoice' },
      pathname: '/lightningReceive',
      paramKey: 'mintHistoryEntry',
    },
    {
      name: 'send (ecash)',
      entry: { type: 'send', id: 's1' },
      pathname: '/sendToken',
      paramKey: 'sendHistoryEntry',
    },
    {
      name: 'receive (ecash)',
      entry: { type: 'receive', id: 'r1' },
      pathname: '/receiveToken',
      paramKey: 'receiveHistoryEntry',
    },
    {
      name: 'lightning melt',
      entry: { type: 'melt', metadata: { method: 'bolt11' } },
      pathname: '/lightningSend',
      paramKey: 'meltHistoryEntry',
    },
  ] as const;

  it.each(cases)(
    'tags $name detail navigation with historyView and the serialized entry',
    ({ entry, pathname, paramKey }) => {
      navigateToTransactionDetail(entry as unknown as HistoryEntry, 'test');

      expect(navigate).toHaveBeenCalledTimes(1);
      const arg = navigate.mock.calls[0][0];
      expect(arg.pathname).toBe(pathname);
      // The read-only signal must ride along on EVERY history navigation — this
      // is what makes the detail screen show the non-clickable "Receiving with".
      expect(arg.params.historyView).toBe('1');
      expect(arg.params[paramKey]).toBe(JSON.stringify(entry));
    }
  );

  it('routes a pending payment-request row to /paymentRequest with reconstructed params', () => {
    navigateToTransactionDetail(
      {
        type: 'receive',
        id: 'pr-req-1',
        metadata: {
          paymentRequestPending: '1',
          operationId: 'req-1',
          encodedRequest: 'creqAxxxx',
          requestAmount: '100',
          requestUnit: 'sat',
          requestMints: JSON.stringify(['https://mint1.example.com']),
        },
      } as unknown as HistoryEntry,
      'test'
    );

    expect(navigate).toHaveBeenCalledTimes(1);
    const arg = navigate.mock.calls[0][0];
    expect(arg.pathname).toBe('/paymentRequest');
    expect(arg.params.historyView).toBe('1');
    expect(JSON.parse(arg.params.paymentRequestEntry)).toMatchObject({
      operationId: 'req-1',
      encodedRequest: 'creqAxxxx',
      amount: 100,
      unit: 'sat',
      mints: ['https://mint1.example.com'],
    });
  });

  it('does NOT navigate when a pending request row is missing its amount (NaN guard)', () => {
    navigateToTransactionDetail(
      {
        type: 'receive',
        id: 'pr-req-2',
        metadata: {
          paymentRequestPending: '1',
          operationId: 'req-2',
          encodedRequest: 'creqAyyyy',
          // requestAmount deliberately absent → Number(undefined) === NaN
          requestUnit: 'sat',
        },
      } as unknown as HistoryEntry,
      'test'
    );

    expect(navigate).not.toHaveBeenCalled();
  });
});
