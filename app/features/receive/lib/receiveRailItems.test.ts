import type { Manager } from '@cashu/coco-core';

import {
  buildBolt12Items,
  buildOnchainItems,
  classifyOnchainQuote,
  classifyPaymentRequest,
  isExpiryElapsed,
  isRailItemCopyable,
} from '@/features/receive/lib/receiveRailItems';

jest.mock('@/shared/stores/global/mintMetadataStore', () => ({
  useMintMetadataStore: { getState: () => ({ getCached: () => undefined }) },
}));

describe('receiveRailItems classification', () => {
  describe('classifyPaymentRequest', () => {
    it('marks a completed single-use request as paid', () => {
      expect(classifyPaymentRequest({ state: 'completed', singleUse: true })).toBe('paid');
    });

    it('marks a completed reusable request as paid too', () => {
      expect(classifyPaymentRequest({ state: 'completed', singleUse: false })).toBe('paid');
    });

    it('marks a cancelled request as cancelled', () => {
      expect(classifyPaymentRequest({ state: 'cancelled', singleUse: true })).toBe('cancelled');
    });

    it('marks an active single-use request as awaiting', () => {
      expect(classifyPaymentRequest({ state: 'active', singleUse: true })).toBe('awaiting');
    });

    it('marks an active reusable (amountless) request as reusable', () => {
      expect(classifyPaymentRequest({ state: 'active', singleUse: false })).toBe('reusable');
    });
  });

  describe('classifyOnchainQuote', () => {
    it('marks a quote with any paid amount as paid', () => {
      expect(classifyOnchainQuote(1000, false)).toBe('paid');
      // paid wins even if the window has elapsed
      expect(classifyOnchainQuote(1000, true)).toBe('paid');
    });

    it('marks an unpaid expired quote as expired', () => {
      expect(classifyOnchainQuote(0, true)).toBe('expired');
    });

    it('marks an unpaid live quote as reusable', () => {
      expect(classifyOnchainQuote(0, false)).toBe('reusable');
    });
  });

  describe('isExpiryElapsed (same rule as the wallet keeps a standing quote by)', () => {
    const nowSeconds = 1_783_520_800;

    // Coco 58abfae watches and claims a pending mint quote whatever its expiry
    // (coco models/MintQuoteClaimability.ts:85, MintOperationWatcherService
    // has no expiry gate), and mints send bolt12 offers with `expiry: 0`
    // meaning "no expiry" (NUT-25 allows null). The wallet keeps such an offer
    // as the standing one (`wallet/src/quotes/reusable.ts` isUnexpired).
    it('treats expiry 0 as no expiry', () => {
      expect(isExpiryElapsed(0, nowSeconds)).toBe(false);
    });

    it('treats null / undefined expiry as never-expiring', () => {
      expect(isExpiryElapsed(null, nowSeconds)).toBe(false);
      expect(isExpiryElapsed(undefined, nowSeconds)).toBe(false);
    });

    it('marks a past absolute expiry as elapsed and a future one as live', () => {
      expect(isExpiryElapsed(nowSeconds - 1, nowSeconds)).toBe(true);
      expect(isExpiryElapsed(nowSeconds, nowSeconds)).toBe(true);
      expect(isExpiryElapsed(nowSeconds + 1, nowSeconds)).toBe(false);
    });
  });

  describe('isRailItemCopyable', () => {
    it('allows copying reusable and awaiting surfaces', () => {
      expect(isRailItemCopyable('reusable')).toBe(true);
      expect(isRailItemCopyable('awaiting')).toBe(true);
    });

    it('blocks copying paid / cancelled / expired surfaces (privacy)', () => {
      expect(isRailItemCopyable('paid')).toBe(false);
      expect(isRailItemCopyable('cancelled')).toBe(false);
      expect(isRailItemCopyable('expired')).toBe(false);
    });
  });
});

const offerQuote = (method: 'bolt12' | 'onchain', mintUrl: string) => ({
  mintUrl,
  quoteId: `${method}-1`,
  method,
  request: method === 'bolt12' ? 'lno1offer' : 'bc1address',
  unit: 'sat',
  expiry: 0,
  createdAt: 1,
});

function railManager(quotes: object[], trustedMints: string[]): Manager {
  return {
    quotes: { mint: { listPending: async () => quotes } },
    mint: { isTrustedMint: async (url: string) => trustedMints.includes(url) },
  } as unknown as Manager;
}

describe('buildBolt12Items', () => {
  it('lists an offer with expiry 0 as reusable and listening, not expired', async () => {
    const manager = railManager(
      [offerQuote('bolt12', 'https://mint.example')],
      ['https://mint.example']
    );

    const [item] = await buildBolt12Items(manager, { standingIds: new Set() });

    expect(item).toMatchObject({ status: 'reusable', listening: true });
  });

  // Coco keeps an untrusted mint's quote in its pending list
  // (sql-storage MintQuoteRepository.ts:263) but its watcher drops the
  // subscription on untrust and skips untrusted mints on startup
  // (MintOperationWatcherService.ts:384,501), so a payment to a copied offer
  // would not be credited until recovered.
  it('lists an offer from a mint that is no longer trusted as inactive, not copyable', async () => {
    const manager = railManager([offerQuote('bolt12', 'https://gone.example')], []);

    const [item] = await buildBolt12Items(manager, { standingIds: new Set() });

    expect(item).toMatchObject({ status: 'inactive', listening: false });
    expect(isRailItemCopyable(item.status)).toBe(false);
  });
});

describe('buildOnchainItems', () => {
  it('lists an unpaid address from a mint that is no longer trusted as inactive', async () => {
    const manager = railManager([offerQuote('onchain', 'https://gone.example')], []);

    const [item] = await buildOnchainItems(manager, { standingIds: new Set() });

    expect(item).toMatchObject({ status: 'inactive', listening: false });
    expect(isRailItemCopyable(item.status)).toBe(false);
  });

  it("keeps a trusted mint's unpaid address reusable and listening", async () => {
    const manager = railManager(
      [offerQuote('onchain', 'https://mint.example')],
      ['https://mint.example']
    );

    const [item] = await buildOnchainItems(manager, { standingIds: new Set() });

    expect(item).toMatchObject({ status: 'reusable', listening: true });
  });
});
