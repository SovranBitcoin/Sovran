import { isPaymentRequestFailureMockEnabled } from '@/features/send/lib/paymentRequestFailureMock';

describe('payment-request failure mock boundary', () => {
  it('preserves the existing Settings control outside production', () => {
    expect(
      isPaymentRequestFailureMockEnabled({
        settingsEnabled: true,
        nodeEnv: 'development',
      })
    ).toBe(true);
  });

  it('accepts only the explicit funded-simulator environment value', () => {
    expect(
      isPaymentRequestFailureMockEnabled({
        settingsEnabled: false,
        fundedE2EEnvironmentValue: '1',
        nodeEnv: 'development',
      })
    ).toBe(true);
    expect(
      isPaymentRequestFailureMockEnabled({
        settingsEnabled: false,
        fundedE2EEnvironmentValue: 'true',
        nodeEnv: 'development',
      })
    ).toBe(false);
  });

  it('fails closed in production even when both controls are enabled', () => {
    expect(
      isPaymentRequestFailureMockEnabled({
        settingsEnabled: true,
        fundedE2EEnvironmentValue: '1',
        nodeEnv: 'production',
      })
    ).toBe(false);
  });
});
