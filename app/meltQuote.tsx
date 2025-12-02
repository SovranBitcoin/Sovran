/**
 * @fileoverview Standalone meltQuote route wrapper
 *
 * This is the standalone version used for direct navigation and deep linking.
 * Param parsing is done by MeltQuoteScreen.
 */

import React from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { MeltQuoteScreen } from 'components/screens/MeltQuoteScreen';

function ModalScreen() {
  const { meltQuote, meltHistoryEntry } = useLocalSearchParams<{
    meltQuote?: string;
    meltHistoryEntry?: string;
  }>();

  return (
    <MeltQuoteScreen
      meltQuote={meltQuote}
      meltHistoryEntry={meltHistoryEntry}
      onCancel={() => {
        router.dismissAll();
      }}
    />
  );
}

export default withSheetProvider(ModalScreen);
