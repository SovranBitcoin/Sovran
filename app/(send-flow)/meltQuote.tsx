/**
 * @fileoverview Send-flow legacy meltQuote route dispatcher. The route body and zod schema live on
 * `MeltQuoteRoute`; this wrapper threads the mint-pill callbacks through
 * the active payment machine so the user can swap mints mid-flow.
 * `Stack.Screen` title comes from `(send-flow)/_layout.tsx`.
 */

import React, { useCallback } from 'react';

import { MeltQuoteRoute } from '@/features/send';
import { usePaymentFlowMachine } from 'colada/react';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { cashuLog } from '@/shared/lib/logger';

export default function ModalScreen() {
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });

  const handleRequestMintList = useCallback(() => {
    cashuLog.info('melt.mint_list.requested', { source: 'pill' });
    void machine.requestMintSelector();
  }, [machine]);

  return <MeltQuoteRoute where="send-flow.meltQuote" onRequestMintList={handleRequestMintList} />;
}
