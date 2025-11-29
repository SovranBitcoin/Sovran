/**
 * @fileoverview Transactions flow meltQuote route wrapper
 *
 * Part of the (transactions-flow) modal group - displays with back button.
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

  return (
    <>
      <Stack.Screen options={{ title: 'Send Lightning' }} />
      <MeltQuoteScreen
        meltQuote={meltQuote}
        meltHistoryEntry={meltHistoryEntry}
        onCancel={() => {
          router.dismissAll();
          router.navigate('/(drawer)/(tabs)');
        }}
      />
    </>
  );
}

export default withSheetProvider(ModalScreen);
