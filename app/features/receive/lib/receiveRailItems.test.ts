import {
  classifyOnchainQuote,
  classifyPaymentRequest,
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
