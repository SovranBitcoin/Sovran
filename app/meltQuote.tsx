/**
 * @fileoverview Standalone meltQuote route wrapper
 *
 * This is the standalone version used for direct navigation and deep linking.
 * Used for viewing existing melt transactions.
 */

import React from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { MeltQuoteScreen } from '@/features/send';

function ModalScreen() {
  const { meltHistoryEntry } = useLocalSearchParams<{
    meltHistoryEntry?: string;
  }>();

  return (
    <MeltQuoteScreen
      meltHistoryEntry={meltHistoryEntry}
      onCancel={() => {
        router.dismissTo('/');
      }}
      onSendSuccess={() => {
        router.dismissTo('/');
      }}
    />
  );
}

export default ModalScreen;
