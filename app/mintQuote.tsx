/**
 * @fileoverview Standalone mintQuote route wrapper
 *
 * This is the standalone version used for direct navigation and deep linking.
 */

import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import type { MintHistoryEntry } from 'coco-cashu-core';
import { MintQuoteScreen } from 'components/screens/MintQuoteScreen';

function ModalScreen() {
  const { mintHistoryEntry: mintHistoryEntryString } = useLocalSearchParams<{
    mintHistoryEntry: string;
  }>();

  const mintHistoryEntry = JSON.parse(mintHistoryEntryString) as MintHistoryEntry;

  return <MintQuoteScreen mintHistoryEntry={mintHistoryEntry} />;
}

export default withSheetProvider(ModalScreen);
