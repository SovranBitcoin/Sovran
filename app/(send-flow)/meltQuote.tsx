/**
 * @fileoverview Send-flow meltQuote route — final screen of an active
 * Lightning send. The route body and zod schema live on
 * `MeltQuoteRoute`; this wrapper threads the mint-pill callbacks through
 * the active payment machine so the user can swap mints mid-flow.
 * `Stack.Screen` title comes from `(send-flow)/_layout.tsx`.
 */

import React, { useCallback } from 'react';

import { MeltQuoteRoute } from '@/features/send';
import { usePaymentFlowMachine } from '@/features/send/providers/CocoPaymentUX';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { cashuLog } from '@/shared/lib/logger';

export default function ModalScreen() {
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });

  const handleMintSelected = useCallback(
    (mintUrl: string) => {
      // Logged so we can tell — when investigating the NFC mint-pill bug —
      // whether the press ended up at changeMint (auto-change, the bug) or at
      // requestMintSelector (correct path) below.
      cashuLog.info('melt.mint.selected', { mintUrl, source: 'pill' });
      void machine.changeMint(mintUrl);
    },
    [machine]
  );
  const handleRequestMintList = useCallback(() => {
    cashuLog.info('melt.mint_list.requested', { source: 'pill' });
    void machine.requestMintSelector();
  }, [machine]);

  return (
    <MeltQuoteRoute
      where="send-flow.meltQuote"
      onMintSelected={handleMintSelected}
      onRequestMintList={handleRequestMintList}
    />
  );
}
