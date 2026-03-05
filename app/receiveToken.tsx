/**
 * @fileoverview Standalone receiveToken route wrapper
 *
 * This is the standalone version used for direct navigation and deep linking.
 * Param parsing and error handling is done by ReceiveTokenScreen.
 */

import React from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { ReceiveTokenScreen } from '@/features/receive';

function ModalScreen() {
  const { receiveHistoryEntry } = useLocalSearchParams<{ receiveHistoryEntry: string }>();

  return (
    <ReceiveTokenScreen
      receiveHistoryEntry={receiveHistoryEntry}
      onNavigateBack={() => router.back()}
      onRedeemSuccess={() => {
        router.dismissTo('/');
      }}
    />
  );
}

export default ModalScreen;
