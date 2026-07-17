import React from 'react';
import { StyleSheet } from 'react-native';

import { meltSelectedMintHost } from '@/features/send/components/MeltSelectedMintProbe';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { View } from '@/shared/ui/primitives/View/View';

/**
 * Accessibility-only evidence of the wallet's currently preferred mint. The
 * header mint pill (`wallet-mint-selector`) carries a data-bearing AX label
 * (name + balance), so device tests can never pin the selected mint off the
 * pill itself — this probe is the only stable signal that a unit switch
 * re-snapped `selectedMint` (e.g. USD → mint.cubabitcoin.org).
 */
export function WalletSelectedMintProbe(): React.ReactElement | null {
  const selectedMint = useMintStore((state) => state.selectedMint);
  const host = selectedMint ? meltSelectedMintHost(selectedMint) : undefined;
  const accessibilityValue = React.useMemo(() => (host ? { text: host } : undefined), [host]);
  if (!host) return null;
  return (
    <View
      testID={`wallet-selected-mint:${host}`}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Selected wallet mint ${host}`}
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
