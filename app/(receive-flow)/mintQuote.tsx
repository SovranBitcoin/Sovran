/**
 * @fileoverview Receive-flow mintQuote route — final screen of an
 * active Lightning receive. The route body and zod schema live on
 * `MintQuoteRoute`; this wrapper threads the mint-pill callbacks through
 * the active payment machine so the user can swap mints mid-flow.
 * `Stack.Screen` title comes from `(receive-flow)/_layout.tsx`.
 */

import React, { useCallback } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { MintQuoteRoute } from '@/features/receive';
import { usePaymentFlowMachine } from '@/features/send/providers/CocoPaymentUX';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';

export default function ModalScreen() {
  // Bind unit to the machine each render so the active flow tracks the
  // currency the route was opened with. MintQuoteRoute revalidates the
  // full param shape; pulling `unit` off the raw params here is just for
  // the always-on machine binding.
  const rawParams = useLocalSearchParams<{ unit?: string }>();
  const unit = typeof rawParams.unit === 'string' ? rawParams.unit : 'sat';

  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext, unit });

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
    <MintQuoteRoute
      where="receive-flow.mintQuote"
      onMintSelected={handleMintSelected}
      onRequestMintList={handleRequestMintList}
    />
  );
}
