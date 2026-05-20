import React from 'react';
import { StyleSheet } from 'react-native';

import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { PrimaryBalance } from '@/features/wallet/components/PrimaryBalance';

import { Log } from '@/shared/lib/logger';
import { zIndex } from '@/shared/styles/tokens';

const BALANCE_BOTTOM_INSET = 24;

interface AccountData {
  unit: string;
}

interface AccountProps {
  account: AccountData;
  // Pinned, deterministic height for the header pager. Set by the wallet so
  // the action rows below sit at a stable Y on first paint — the boot-splash
  // → QR morph reads the QR button's window position, and a flex-driven
  // height would let async layout (history, wallpaper image, safe-area)
  // shift it after the splash has already locked onto a target rect.
  pagerHeight: number;
}

export function Account({ account, pagerHeight }: AccountProps): React.ReactElement {
  return (
    <Log name="Account">
      <View style={[styles.container, { height: pagerHeight }]}>
        <VStack style={styles.balanceSlot}>
          <VStack align="center" gap={8}>
            <PrimaryBalance account={account} />
          </VStack>
        </VStack>
      </View>
    </Log>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    width: '100%',
    zIndex: zIndex.sticky,
  },
  balanceSlot: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: BALANCE_BOTTOM_INSET,
  },
});
