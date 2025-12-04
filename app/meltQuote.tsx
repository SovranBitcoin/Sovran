/**
 * @fileoverview Standalone meltQuote route wrapper
 *
 * This is the standalone version used for direct navigation and deep linking.
 * Supports two flows:
 * 1. Creating new quote: invoice or lnUrlOrAddress + amount params
 * 2. Viewing existing: meltHistoryEntry param
 */

import React from 'react';
import { useLocalSearchParams, router } from 'expo-router';
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
    <MeltQuoteScreen
      meltHistoryEntry={meltHistoryEntry}
      invoice={invoice}
      lnUrlOrAddress={lnUrlOrAddress}
      amount={amount ? parseInt(amount, 10) : undefined}
      onCancel={() => {
        router.dismissAll();
      }}
      onSendSuccess={() => {
        router.dismissAll();
      }}
    />
  );
}

export default withSheetProvider(ModalScreen);
