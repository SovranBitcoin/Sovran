import React from 'react';
import { StyleSheet } from 'react-native';

import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { PrimaryBalance } from '@/features/wallet/components/PrimaryBalance';

import { Log } from '@/shared/lib/logger';

const BALANCE_BOTTOM_INSET = 24;

interface AccountData {
  unit: string;
}

interface AccountProps {
  account: AccountData;
}

export function Account({ account }: AccountProps): React.ReactElement {
  return (
    <Log name="Account">
      <View style={styles.container}>
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
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 144,
    overflow: 'hidden',
    width: '100%',
    zIndex: 10,
  },
  balanceSlot: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: BALANCE_BOTTOM_INSET,
  },
});
