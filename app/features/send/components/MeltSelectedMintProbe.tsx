import React from 'react';
import { StyleSheet } from 'react-native';

import { View } from '@/shared/ui/primitives/View/View';

export function meltSelectedMintHost(mintUrl: string): string {
  try {
    return new URL(mintUrl).hostname.toLowerCase() || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Accessibility-only evidence that binds a melt screen's selected mint to its
 * current entry id. The host-scoped prefix lets device tests wait for and
 * capture the replacement preview without accidentally reusing the old one.
 */
export function MeltSelectedMintProbe({
  mintUrl,
  transactionId,
}: {
  mintUrl: string;
  transactionId: string;
}): React.ReactElement {
  const host = meltSelectedMintHost(mintUrl);
  const accessibilityValue = React.useMemo(() => ({ text: host }), [host]);
  return (
    <View
      testID={`melt-selected-mint:${host}:${transactionId}`}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Selected payment mint ${host}`}
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
