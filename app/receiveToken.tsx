/**
 * @fileoverview Standalone receiveToken route wrapper
 *
 * This is the standalone version used for direct navigation and deep linking.
 */

import React from 'react';
import { TouchableOpacity } from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import type { ReceiveHistoryEntry } from 'coco-cashu-core';
import { ReceiveTokenScreen } from 'components/screens/ReceiveTokenScreen';
import { useTheme } from 'providers/ThemeProvider';
import Icon from 'assets/icons';

function ModalScreen() {
  const { receiveHistoryEntry: receiveHistoryEntryString } = useLocalSearchParams<{
    receiveHistoryEntry: string;
  }>();
  const { getPrimaryColor } = useTheme();

  const CloseButton = () => (
    <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
      <Icon name="material-symbols:close-rounded" size={24} color={getPrimaryColor('0')} />
    </TouchableOpacity>
  );

  const receiveHistoryEntry = JSON.parse(receiveHistoryEntryString) as ReceiveHistoryEntry & {
    token?: string;
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Receive Ecash',
          headerTitleStyle: { color: getPrimaryColor('0') },
          headerTintColor: getPrimaryColor('0'),
          headerLeft: () => <CloseButton />,
        }}
      />
      <ReceiveTokenScreen
        receiveHistoryEntry={receiveHistoryEntry}
        onNavigateBack={() => router.back()}
        onRedeemSuccess={() => {
          router.dismissAll();
          router.push('/(drawer)/(tabs)');
        }}
      />
    </>
  );
}

export default withSheetProvider(ModalScreen);
