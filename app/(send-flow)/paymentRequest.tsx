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
import { usePaymentFlowMachine } from '@/features/send/providers/CocoPaymentUX';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';

function ModalScreen() {
  const { paymentRequestEntry } = useLocalSearchParams<{
    paymentRequestEntry?: string;
  }>();

  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });

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
        key={paymentRequestEntry}
        paymentRequestEntry={paymentRequestEntry}
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
