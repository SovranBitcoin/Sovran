import React, { useMemo, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import {
  E2E_READY_PROOF_STATUS_ID,
  getE2EReadyProofStatus,
  serializeE2EReadyProofStatus,
  subscribeE2EReadyProofStatus,
} from '@/shared/lib/cashu/e2eReadyProofStatus';
import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';

/** Accessibility-only, non-secret completion evidence for the owned funded
 * simulator. Release bundles and ordinary dev sessions never render it. */
export function E2EReadyProofProbe(): React.ReactElement | null {
  const status = useSyncExternalStore(
    subscribeE2EReadyProofStatus,
    getE2EReadyProofStatus,
    getE2EReadyProofStatus
  );
  const serialized = useMemo(() => serializeE2EReadyProofStatus(status), [status]);
  // Android carries the payload percent-encoded in accessibilityLabel
  // (→ content-desc → the ax-adapter's value): a raw JSON label's
  // commas/quotes/braces make Android drop the whole content-desc, exactly as
  // with TransactionProbe. iOS keeps the label + JSON accessibilityValue split.
  const androidPayload = Platform.OS === 'android' ? encodeURIComponent(serialized) : undefined;
  if (
    !__DEV__ ||
    !process.env.EXPO_PUBLIC_E2E_SEED_EXPORT_ENDPOINT ||
    !process.env.EXPO_PUBLIC_E2E_SEED_EXPORT_TOKEN ||
    !process.env.EXPO_PUBLIC_E2E_FUNDED_ASSETS
  ) {
    return null;
  }
  return (
    <E2EAccessibilityProbe
      testID={E2E_READY_PROOF_STATUS_ID}
      accessibilityLabel={androidPayload ?? 'Funded test proof reconciliation'}
      value={androidPayload ? undefined : serialized}
    />
  );
}
