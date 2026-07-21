import { Platform } from 'react-native';

/**
 * Fail-closed gate for e2e mint-fault injection, mirroring the
 * paymentRequestFailureMock boundary: production always wins, and the env
 * value must be present (the harness-owned Metro serializes a rule set —
 * possibly empty — into it; an ordinary dev session never has it).
 *
 * Static property access only: babel-preset-expo inlines EXPO_PUBLIC_* at
 * transform time, so the env read must stay a literal member expression.
 */
export function isMintFaultInjectionEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return (
    __DEV__ &&
    Platform.OS !== 'web' &&
    typeof process.env.EXPO_PUBLIC_E2E_MINT_FAULTS === 'string' &&
    process.env.EXPO_PUBLIC_E2E_MINT_FAULTS.length > 0
  );
}

export function mintFaultLaunchRuleSetRaw(): string | undefined {
  return process.env.EXPO_PUBLIC_E2E_MINT_FAULTS;
}
