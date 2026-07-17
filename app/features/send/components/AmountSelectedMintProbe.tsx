import React from 'react';
import { StyleSheet } from 'react-native';

import { View } from '@/shared/ui/primitives/View/View';

import { meltSelectedMintHost } from './MeltSelectedMintProbe';

/**
 * Accessibility-only evidence of which mint the amount screen is preselected
 * to. The SwiftUI mint pill (`amount-mint-selector`) swallows its children in
 * the AX tree, so device tests can never read the mint name off the pill —
 * this probe is the only signal that the balance-aware preselection picked
 * the funded mint.
 */
export function AmountSelectedMintProbe({ mintUrl }: { mintUrl: string }): React.ReactElement {
  const host = meltSelectedMintHost(mintUrl);
  const accessibilityValue = React.useMemo(() => ({ text: host }), [host]);
  return (
    <View
      testID={`amount-selected-mint:${host}`}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Selected amount mint ${host}`}
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
