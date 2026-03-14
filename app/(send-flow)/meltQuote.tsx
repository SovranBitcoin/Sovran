/**
 * @fileoverview Send flow meltQuote route wrapper
 *
 * Part of the (send-flow) modal group - displays with back button.
 * Supports two flows:
 * 1. Creating new quote: meltTarget + amount params
 * 2. Viewing existing: meltHistoryEntry param
 */

import React, { useCallback } from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';

import { debugLog } from '@/shared/lib/debugLog';
import { MeltQuoteScreen } from '@/features/send';
import {
  usePaymentFlowMint,
  usePaymentFlowMachine,
} from '@/features/send/providers/PaymentFlowProvider';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';

function ModalScreen() {
  const { meltHistoryEntry, meltTarget, amount, selectedMintUrl } = useLocalSearchParams<{
    meltHistoryEntry?: string;
    meltTarget?: string;
    amount?: string;
    selectedMintUrl?: string;
  }>();

  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });
  const flowMint = usePaymentFlowMint();
  const effectiveMint = flowMint ?? selectedMintUrl;

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
          // So native-stack back goes through JS and usePreventRemove can run cleanup (free reserved proofs).
          headerBackButtonMenuEnabled: false,
        }}
      />
      <MeltQuoteScreen
        key={effectiveMint}
        meltHistoryEntry={meltHistoryEntry}
        meltTarget={meltTarget}
        amount={amount ? parseInt(amount, 10) : undefined}
        selectedMintUrl={effectiveMint}
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
