/**
 * @fileoverview Send flow meltQuote route wrapper
 *
 * Part of the (send-flow) modal group - displays with back button.
 */

import React from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { MeltQuoteResponse } from '@cashu/cashu-ts';
import { MeltHistoryEntry } from 'coco-cashu-core';
import { MeltQuoteScreen } from 'components/screens/MeltQuoteScreen';

function ModalScreen() {
  const { meltQuote: meltQuoteString, meltHistoryEntry: meltHistoryEntryString } =
    useLocalSearchParams<{
      meltQuote?: string;
      meltHistoryEntry?: string;
    }>();

  const meltQuote = meltQuoteString
    ? (JSON.parse(meltQuoteString) as MeltQuoteResponse)
    : undefined;
  const meltHistoryEntry = meltHistoryEntryString
    ? (JSON.parse(meltHistoryEntryString) as MeltHistoryEntry)
    : undefined;

  return (
    <>
      <Stack.Screen options={{ title: 'Send Lightning' }} />
      <MeltQuoteScreen
        meltQuote={meltQuote}
        meltHistoryEntry={meltHistoryEntry}
        onCancel={() => {
          router.dismissAll();
          router.push('/(drawer)/(tabs)');
        }}
      />
    </>
  );
}

export default withSheetProvider(ModalScreen);
