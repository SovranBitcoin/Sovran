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

import { MintQuoteScreen } from '@/features/receive';
import { usePaymentFlowMint, usePaymentFlowMachine } from '@/features/send/providers/CocoPaymentUX';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';

function ModalScreen() {
  const params = useLocalSearchParams<{
    mintHistoryEntry: string;
    unit?: string;
  }>();

  const unit = params.unit ?? 'sat';

  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext, unit });
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
      <Stack.Screen options={{ headerTitle: 'Receive' }} />
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
