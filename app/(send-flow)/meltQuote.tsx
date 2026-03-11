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
import { MeltQuoteScreen } from '@/features/send';

function ModalScreen() {
  const { meltHistoryEntry, invoice, lnUrlOrAddress, amount, selectedMintUrl } =
    useLocalSearchParams<{
      meltHistoryEntry?: string;
      invoice?: string;
      lnUrlOrAddress?: string;
      amount?: string;
      selectedMintUrl?: string;
    }>();

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Send Lightning',
          // So native-stack back goes through JS and usePreventRemove can run cleanup (free reserved proofs).
          headerBackButtonMenuEnabled: false,
        }}
      />
      <MeltQuoteScreen
        meltHistoryEntry={meltHistoryEntry}
        invoice={invoice}
        lnUrlOrAddress={lnUrlOrAddress}
        amount={amount ? parseInt(amount, 10) : undefined}
        selectedMintUrl={selectedMintUrl}
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

export default ModalScreen;
