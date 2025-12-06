/**
 * @fileoverview Send flow meltQuote route wrapper
 *
 * Part of the (send-flow) modal group - displays with back button.
 * Supports two flows:
 * 1. Creating new quote: invoice or lnUrlOrAddress + amount params
 * 2. Viewing existing: meltHistoryEntry param
 */

import React from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { MeltQuoteScreen } from 'components/screens/MeltQuoteScreen';

function ModalScreen() {
  const { meltHistoryEntry, invoice, lnUrlOrAddress, amount } = useLocalSearchParams<{
    meltHistoryEntry?: string;
    invoice?: string;
    lnUrlOrAddress?: string;
    amount?: string;
  }>();

  return (
    <>
      <Stack.Screen options={{ title: 'Send Lightning' }} />
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
