import React, { useMemo, useSyncExternalStore } from 'react';
import { StyleSheet } from 'react-native';

import {
  E2E_READY_PROOF_STATUS_ID,
  getE2EReadyProofStatus,
  serializeE2EReadyProofStatus,
  subscribeE2EReadyProofStatus,
} from '@/shared/lib/cashu/e2eReadyProofStatus';
import { View } from '@/shared/ui/primitives/View/View';

/** Accessibility-only, non-secret completion evidence for the owned funded
 * simulator. Release bundles and ordinary dev sessions never render it. */
export function E2EReadyProofProbe(): React.ReactElement | null {
  const status = useSyncExternalStore(
    subscribeE2EReadyProofStatus,
    getE2EReadyProofStatus,
    getE2EReadyProofStatus
  );
  const value = useMemo(() => ({ text: serializeE2EReadyProofStatus(status) }), [status]);
  if (
    !__DEV__ ||
    !process.env.EXPO_PUBLIC_E2E_SEED_EXPORT_ENDPOINT ||
    !process.env.EXPO_PUBLIC_E2E_SEED_EXPORT_TOKEN ||
    !process.env.EXPO_PUBLIC_E2E_FUNDED_ASSETS
  ) {
    return null;
  }
  return (
    <View
      testID={E2E_READY_PROOF_STATUS_ID}
      accessible
      accessibilityRole="text"
      accessibilityLabel="Funded test proof reconciliation"
      accessibilityValue={value}
      importantForAccessibility="yes"
      collapsable={false}
      pointerEvents="none"
      style={styles.probe}
    />
  );
}

const styles = StyleSheet.create({
  probe: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 1,
    height: 1,
  },
});
