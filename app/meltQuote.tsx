/**
 * @fileoverview Standalone meltQuote route wrapper
 *
 * This is the standalone version used for direct navigation and deep linking.
 */

import React from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { MeltQuoteResponse } from '@cashu/cashu-ts';
import { MeltHistoryEntry } from 'coco-cashu-core';
import { MeltQuoteScreen } from 'components/screens/MeltQuoteScreen';
import { useTheme } from 'providers/ThemeProvider';

function ModalScreen() {
  const { meltQuote: meltQuoteString, meltHistoryEntry: meltHistoryEntryString } =
    useLocalSearchParams<{
      meltQuote?: string;
      meltHistoryEntry?: string;
    }>();
  const { getPrimaryColor } = useTheme();

  const meltQuote = meltQuoteString
    ? (JSON.parse(meltQuoteString) as MeltQuoteResponse)
    : undefined;
  const meltHistoryEntry = meltHistoryEntryString
    ? (JSON.parse(meltHistoryEntryString) as MeltHistoryEntry)
    : undefined;

  return (
    <>
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
