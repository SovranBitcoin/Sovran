/**
 * @fileoverview Transactions flow mintQuote route wrapper
 *
 * Part of the (transactions-flow) modal group - displays with back button.
 */

import React from 'react';
import { useLocalSearchParams, Stack } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import type { MintHistoryEntry } from 'coco-cashu-core';
import { MintQuoteScreen, getFormattedMintQuoteTitle } from 'components/screens/MintQuoteScreen';

function ModalScreen() {
  const { mintHistoryEntry: mintHistoryEntryString } = useLocalSearchParams<{
    mintHistoryEntry: string;
  }>();

  const mintHistoryEntry = JSON.parse(mintHistoryEntryString) as MintHistoryEntry;
  const title = getFormattedMintQuoteTitle(mintHistoryEntry.unit);

  return (
    <>
      <Stack.Screen options={{ headerTitle: title }} />
      <MintQuoteScreen mintHistoryEntry={mintHistoryEntry} />
    </>
  );
}

export default withSheetProvider(ModalScreen);
