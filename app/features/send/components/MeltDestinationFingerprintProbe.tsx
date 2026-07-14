import React from 'react';
import { StyleSheet } from 'react-native';

import { View } from '@/shared/ui/primitives/View/View';
import { paymentDestinationFingerprint } from '@/features/send/lib/paymentDestinationFingerprint';

/**
 * Non-visual accessibility seam for proving that a Lightning destination
 * survives a mint change. Only a one-way fingerprint crosses the seam.
 */
export function MeltDestinationFingerprintProbe({ destination }: { destination: string }) {
  const fingerprint = paymentDestinationFingerprint(destination);
  const accessibilityValue = React.useMemo(() => ({ text: fingerprint }), [fingerprint]);
  return (
    <View
      testID="melt-destination-fingerprint"
      accessible
      accessibilityRole="text"
      accessibilityLabel="Payment destination fingerprint"
      accessibilityValue={accessibilityValue}
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
