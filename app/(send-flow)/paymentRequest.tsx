/**
 * @fileoverview Send flow paymentRequest route wrapper
 *
 * Part of the (send-flow) modal group - displays with back button.
 * The navigateToPaymentRequest handler navigates here with a synthetic
 * entry containing the encoded payment request.
 */

import React, { useCallback } from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';

import { PaymentRequestScreen } from '@/features/send';
import {
  usePaymentFlowMint,
  usePaymentFlowMachine,
} from '@/features/send/providers/PaymentFlowProvider';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';

function ModalScreen() {
  const { paymentRequestEntry } = useLocalSearchParams<{
    paymentRequestEntry?: string;
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
          title: 'Payment Request',
          headerBackButtonMenuEnabled: false,
        }}
      />
      <PaymentRequestScreen
        key={flowMint}
        paymentRequestEntry={paymentRequestEntry}
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
