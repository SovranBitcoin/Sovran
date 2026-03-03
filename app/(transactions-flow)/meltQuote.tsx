/**
 * @fileoverview Transactions flow meltQuote route wrapper
 *
 * Part of the (transactions-flow) modal group - displays with back button.
 * Primarily used for viewing existing transactions.
 */

import React from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { MeltQuoteScreen } from '@/features/send';

function ModalScreen() {
  const { meltHistoryEntry, invoice, lnUrlOrAddress, amount } = useLocalSearchParams<{
    meltHistoryEntry?: string;
    invoice?: string;
    lnUrlOrAddress?: string;
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
        invoice={invoice}
        lnUrlOrAddress={lnUrlOrAddress}
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

export default withSheetProvider(ModalScreen);
