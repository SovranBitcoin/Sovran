/**
 * @fileoverview Receive flow mintQuote route wrapper
 *
 * Displays a mint quote that was created before navigation.
 * The mintHistoryEntry param contains the full MintHistoryEntry as JSON.
 * Wires up the resolver so MintSelector can trigger changeMint(),
 * which re-runs the createMintQuote handler with the new mint.
 */

import React, { useCallback } from 'react';
import { useLocalSearchParams, Stack } from 'expo-router';

import { debugLog } from '@/shared/lib/debugLog';
import { MintQuoteScreen, getFormattedMintQuoteTitle } from '@/features/receive';
import {
  usePaymentFlowMint,
  usePaymentFlowMachine,
} from '@/features/send/providers/PaymentFlowProvider';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';

function ModalScreen() {
  const params = useLocalSearchParams<{
    mintHistoryEntry: string;
    unit?: string;
  }>();

  const unit = params.unit ?? 'sat';
  const title = getFormattedMintQuoteTitle(unit);

  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext, unit });
  const flowMint = usePaymentFlowMint();

  const handleMintSelected = useCallback(
    (mintUrl: string) => {
      debugLog({
        location: 'MintQuoteRoute.handleMintSelected',
        message: 'MintSelector: mint selected from mint quote screen',
        phase: 'before',
        data: { mintUrl, persist: false, source: 'mintQuoteScreen' },
      });
      void machine.changeMint(mintUrl);
    },
    [machine]
  );

  const handleRequestMintList = useCallback(() => {
    debugLog({
      location: 'MintQuoteRoute.handleRequestMintList',
      message: 'MintSelector: request mint list from mint quote screen',
      phase: 'before',
      data: { source: 'mintQuoteScreen' },
    });
    void machine.requestMintSelector();
  }, [machine]);

  return (
    <>
      <Stack.Screen options={{ headerTitle: title }} />
      <MintQuoteScreen
        key={flowMint ?? params.mintHistoryEntry}
        mintHistoryEntry={params.mintHistoryEntry}
        selectedMintUrl={flowMint}
        onMintSelected={handleMintSelected}
        onRequestMintList={handleRequestMintList}
      />
    </>
  );
}

export default ModalScreen;
