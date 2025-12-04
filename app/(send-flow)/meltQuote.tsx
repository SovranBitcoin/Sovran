/**
 * @fileoverview Send flow meltQuote route wrapper
 *
 * Part of the (send-flow) modal group - displays with back button.
 * Param parsing is done by MeltQuoteScreen.
 */

import React from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { MeltQuoteScreen } from 'components/screens/MeltQuoteScreen';

function ModalScreen() {
  const { meltQuote, meltHistoryEntry } = useLocalSearchParams<{
    meltQuote?: string;
    meltHistoryEntry?: string;
  }>();

  console.log('[LIGHTNING-FLOW] meltQuote.tsx received params', {
    meltQuoteReceived: !!meltQuote,
    meltHistoryEntryReceived: !!meltHistoryEntry,
    meltQuoteParsed: meltQuote ? JSON.parse(meltQuote) : null,
  });

  return (
    <>
      <Stack.Screen options={{ title: 'Send Lightning' }} />
      <MeltQuoteScreen
        meltQuote={meltQuote}
        meltHistoryEntry={meltHistoryEntry}
        onCancel={() => {
          router.dismissAll();
        }}
      />
    </>
  );
}

export default withSheetProvider(ModalScreen);
