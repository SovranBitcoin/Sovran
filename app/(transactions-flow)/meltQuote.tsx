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
  const { meltHistoryEntry } = useLocalSearchParams<{
    meltHistoryEntry?: string;
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
        onCancel={() => {
          router.dismissTo('/');
        }}
      />
    </>
  );
}

export default ModalScreen;
