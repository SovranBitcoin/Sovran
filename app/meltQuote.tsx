/**
 * @fileoverview Standalone meltQuote route wrapper
 *
 * This is the standalone version used for direct navigation and deep linking.
 * Supports two flows:
 * 1. Creating new quote: meltTarget + amount params
 * 2. Viewing existing: meltHistoryEntry param
 */

import React from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { MeltQuoteScreen } from '@/features/send';

function ModalScreen() {
  const { meltHistoryEntry, meltTarget, amount } = useLocalSearchParams<{
    meltHistoryEntry?: string;
    meltTarget?: string;
    amount?: string;
  }>();

  return (
    <MeltQuoteScreen
      meltHistoryEntry={meltHistoryEntry}
      meltTarget={meltTarget}
      amount={amount ? parseInt(amount, 10) : undefined}
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
