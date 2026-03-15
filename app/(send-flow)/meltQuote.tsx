/**
 * @fileoverview Send flow meltQuote route wrapper
 *
 * Part of the (send-flow) modal group - displays with back button.
 * The navigateToMeltPreview handler navigates here instantly with a
 * synthetic meltHistoryEntry. The prepare action (on-screen) runs
 * prepareMeltBolt11 and re-navigates with the real entry + operationId.
 */

import React, { useCallback, useEffect } from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';

import { debugLog } from '@/shared/lib/debugLog';
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

  useEffect(() => {
    debugLog({
      location: 'MeltQuoteRoute',
      message: 'meltQuote route mounted with params',
      phase: 'entry',
      data: {
        hasMeltHistoryEntry: !!meltHistoryEntry,
        operationId: operationId ?? null,
      },
    });
  }, [meltHistoryEntry, operationId]);

  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });
  const flowMint = usePaymentFlowMint();

  const handleMintSelected = useCallback(
    (mintUrl: string) => {
      debugLog({
        location: 'MeltQuoteRoute.handleMintSelected',
        message: 'MintSelector: mint selected from melt quote screen',
        phase: 'before',
        data: { mintUrl, persist: false, source: 'meltQuoteScreen' },
      });
      void machine.changeMint(mintUrl);
    },
    [machine]
  );

  const handleRequestMintList = useCallback(() => {
    debugLog({
      location: 'MeltQuoteRoute.handleRequestMintList',
      message: 'MintSelector: request mint list from melt quote screen',
      phase: 'before',
      data: { source: 'meltQuoteScreen' },
    });
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
