/**
 * @fileoverview Send flow meltQuote route wrapper
 *
 * Part of the (send-flow) modal group - displays with back button.
 * The navigateToMeltPreview handler navigates here instantly with a
 * synthetic meltHistoryEntry. The prepare action (on-screen) runs
 * prepareMeltBolt11 and re-navigates with the real entry + operationId.
 */

import React, { useCallback } from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';

import { MeltQuoteScreen } from '@/features/send';
import {
  usePaymentFlowMint,
  usePaymentFlowMachine,
} from '@/features/send/providers/PaymentFlowProvider';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';

function ModalScreen() {
  const { meltHistoryEntry, operationId } = useLocalSearchParams<{
    meltHistoryEntry?: string;
    operationId?: string;
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
        operationId={operationId}
        selectedMintUrl={flowMint}
        onCancel={() => {
          router.dismissTo('/');
        }}
        onSendSuccess={() => {
          router.dismissTo('/');
        }}
        onMintSelected={handleMintSelected}
        onRequestMintList={handleRequestMintList}
      />
    </>
  );
}

export default ModalScreen;
