/**
 * @fileoverview Transactions flow mintQuote route wrapper
 *
 * Part of the (transactions-flow) modal group - displays with back button.
 */

import React from 'react';
import { useLocalSearchParams, Stack } from 'expo-router';
import type { MintHistoryEntry } from '@cashu/coco-core';
import { MintQuoteScreen } from '@/features/receive';

function ModalScreen() {
  const { mintHistoryEntry: mintHistoryEntryString } = useLocalSearchParams<{
    mintHistoryEntry: string;
  }>();

  const mintHistoryEntry = JSON.parse(mintHistoryEntryString) as MintHistoryEntry;

  return (
    <>
      <Stack.Screen options={{ headerTitle: 'Receive' }} />
      <MintQuoteScreen mintHistoryEntry={mintHistoryEntry} />
    </>
  );
}

export default ModalScreen;
