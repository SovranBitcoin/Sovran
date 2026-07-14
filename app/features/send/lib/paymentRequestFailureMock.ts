interface PaymentRequestFailureMockConfig {
  settingsEnabled: boolean;
  fundedE2EEnvironmentValue?: string;
  nodeEnv?: string;
}

/**
 * Resolves the two deliberate development controls for payment-request
 * delivery failures. The simulator environment is exact-match rather than
 * truthy so an inherited or misspelled value cannot silently turn it on.
 *
 * The wallet operation layer independently rejects every mock-failure getter
 * in production. Keeping the same boundary here makes the app-owned Metro
 * seam fail closed before it reaches that lower-level guard.
 */
export function isPaymentRequestFailureMockEnabled({
  settingsEnabled,
  fundedE2EEnvironmentValue,
  nodeEnv,
}: PaymentRequestFailureMockConfig): boolean {
  if (nodeEnv === 'production') return false;
  return settingsEnabled || fundedE2EEnvironmentValue === '1';
}
