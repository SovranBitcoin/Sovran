import { paymentDestinationFingerprint } from '@/features/send/lib/paymentDestinationFingerprint';

describe('payment destination fingerprint', () => {
  it('is stable and one-way for device assertions', () => {
    const destination = 'lnbc40n1p-secret-payment-payload';
    const fingerprint = paymentDestinationFingerprint(destination);

    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(paymentDestinationFingerprint(destination)).toBe(fingerprint);
    expect(paymentDestinationFingerprint(`${destination}-changed`)).not.toBe(fingerprint);
    expect(fingerprint).not.toContain(destination);
  });
});
