/**
 * @fileoverview Standalone receiveToken route wrapper
 *
 * This is the standalone version used for direct navigation and deep linking.
 */

import React from 'react';
import { useLocalSearchParams, router } from 'expo-router';
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
