/**
 * @fileoverview Transactions flow meltQuote route wrapper
 *
 * Part of the (transactions-flow) modal group - displays with back button.
 * Primarily used for viewing existing transactions.
 */

import React from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { MeltQuoteScreen } from '@/features/send';

function ModalScreen() {
  const { meltHistoryEntry, meltTarget, amount } = useLocalSearchParams<{
    meltHistoryEntry?: string;
    meltTarget?: string;
    amount?: string;
  }>();

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Send Lightning',
          headerBackButtonMenuEnabled: false,
        }}
      />
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
    </>
  );
}

export default ModalScreen;
