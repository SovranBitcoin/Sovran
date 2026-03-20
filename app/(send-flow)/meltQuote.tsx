/**
 * @fileoverview Send flow meltQuote route wrapper
 *
 * Part of the (send-flow) modal group - displays with back button.
 * The navigateToMeltPreview handler navigates here with a serialized
 * meltHistoryEntry; actions are handled by the screen-action system.
 */

import React, { useCallback } from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';

import { MeltQuoteScreen } from '@/features/send';
import { usePaymentFlowMint, usePaymentFlowMachine } from '@/features/send/providers/CocoPaymentUX';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';

function ModalScreen() {
  const { meltHistoryEntry } = useLocalSearchParams<{
    meltHistoryEntry?: string;
  }>();

  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });
  const flowMint = usePaymentFlowMint();

  const handleMintSelected = useCallback(
    (mintUrl: string) => {
      void machine.changeMint(mintUrl);
    },
    [machine]
  );

  const handleRequestMintList = useCallback(() => {
    void machine.requestMintSelector();
  }, [machine]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Send Lightning',
          headerBackButtonMenuEnabled: false,
        }}
      />
      <MeltQuoteScreen
        key={flowMint}
        meltHistoryEntry={meltHistoryEntry}
        selectedMintUrl={flowMint}
        onCancel={() => {
          router.dismissTo('/');
        }}
        onMintSelected={handleMintSelected}
        onRequestMintList={handleRequestMintList}
      />
    </>
  );
}

export default ModalScreen;
