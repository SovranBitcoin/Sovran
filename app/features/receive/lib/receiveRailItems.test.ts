import {
  classifyOnchainQuote,
  classifyPaymentRequest,
  isExpiryElapsed,
  isRailItemCopyable,
} from '@/features/receive/lib/receiveRailItems';

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

  describe('isExpiryElapsed (mirrors coco isExpiredMintQuoteSnapshot)', () => {
    const now = 1_783_520_800; // fixed "now" in seconds

    it('treats expiry 0 as expired — coco reads 0 <= now, so bolt12 offers (expiry 0) are never watched', () => {
      expect(isExpiryElapsed(0, now)).toBe(true);
    });

    it('treats null / undefined expiry as never-expiring', () => {
      expect(isExpiryElapsed(null, now)).toBe(false);
      expect(isExpiryElapsed(undefined, now)).toBe(false);
    });

    it('marks a past absolute expiry as elapsed and a future one as live', () => {
      expect(isExpiryElapsed(now - 1, now)).toBe(true);
      expect(isExpiryElapsed(now, now)).toBe(true);
      expect(isExpiryElapsed(now + 1, now)).toBe(false);
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
