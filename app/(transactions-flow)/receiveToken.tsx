/**
 * @fileoverview Transactions flow receiveToken route wrapper
 *
 * Part of the (transactions-flow) modal group - displays with back button.
 */

import React from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import type { ReceiveHistoryEntry } from 'coco-cashu-core';
import { ReceiveTokenScreen } from 'components/screens/ReceiveTokenScreen';

function ModalScreen() {
  const { receiveHistoryEntry: receiveHistoryEntryString } = useLocalSearchParams<{
    receiveHistoryEntry: string;
  }>();

  const receiveHistoryEntry = JSON.parse(receiveHistoryEntryString) as ReceiveHistoryEntry & {
    token?: string;
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Receive Ecash' }} />
      <ReceiveTokenScreen
        receiveHistoryEntry={receiveHistoryEntry}
        onNavigateBack={() => router.back()}
        onRedeemSuccess={() => {
          router.dismissAll();
          router.navigate('/(drawer)/(tabs)');
        }}
      />
    </>
  );
}

export default withSheetProvider(ModalScreen);
