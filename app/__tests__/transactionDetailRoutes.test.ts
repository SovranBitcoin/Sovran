import type { HistoryEntry } from '@cashu/coco-core';

import {
  getMeltDetailPathname,
  getMintDetailPathname,
} from '@/shared/lib/nav/transactionDetailRoutes';

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
