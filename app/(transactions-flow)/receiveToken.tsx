/**
 * @fileoverview Transactions flow receiveToken route wrapper
 *
 * Part of the (transactions-flow) modal group - displays with back button.
 * Param parsing and error handling is done by ReceiveTokenScreen.
 */

import React from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { ReceiveTokenScreen } from 'components/screens/ReceiveTokenScreen';

function ModalScreen() {
  const { receiveHistoryEntry } = useLocalSearchParams<{ receiveHistoryEntry: string }>();

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
