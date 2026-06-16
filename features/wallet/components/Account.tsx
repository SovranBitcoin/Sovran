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
  // Phone-dimension floor for the balance region. The region grows naturally
  // with its contents (e.g. the PENDING/RESERVED/REDEEMING pills) above this
  // minimum, so nothing clips when pills are present and it stays visually
  // balanced when they're absent. The boot-splash → QR morph stays correct
  // because the splash gate remeasures the QR position (requestQRButtonRemeasure)
  // right before morphing, so a content-driven height is safe.
  minHeight: number;
}

export function Account({ account, minHeight }: AccountProps): React.ReactElement {
  return (
    <Log name="Account">
      <View style={[styles.container, { minHeight }]}>
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
    width: '100%',
    zIndex: zIndex.sticky,
  },
  balanceSlot: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: BALANCE_BOTTOM_INSET,
  },
});
