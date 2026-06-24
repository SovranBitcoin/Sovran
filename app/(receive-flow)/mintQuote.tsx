/**
 * @fileoverview Receive-flow legacy mintQuote route dispatcher. The route body and zod schema live on
 * `MintQuoteRoute`; this wrapper threads the mint-pill callbacks through
 * the active payment machine so the user can swap mints mid-flow.
 * `MintQuoteRoute` dispatches to the rail-specific receive screen from the
 * serialized entry.
 */

import React, { useEffect } from 'react';
import { z } from 'zod';

import { MintQuoteRoute } from '@/features/receive';
import { usePaymentFlowMachine } from '@sovranbitcoin/colada/react';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { cashuLog } from '@/shared/lib/logger';

const ParamsSchema = z.object({
  unit: z.string().min(1).max(16).optional(),
});

export default function ModalScreen() {
  // Bind unit to the machine each render so the active flow tracks the
  // currency the route was opened with. MintQuoteRoute revalidates the
  // full param shape; pulling `unit` off the validated params here is for
  // the always-on machine binding.
  const params = useRouteParams(ParamsSchema, { where: 'receive-flow.mintQuote' });
  const unit = params?.unit ?? 'sat';

  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext, unit });

  useEffect(() => {
    cashuLog.info('receive.mint_quote.route.ready', {
      where: 'receive-flow.mintQuote',
      unit,
      paramsValid: !!params,
      trustedMintCount: walletContext.trustedMintUrls.length,
      balanceMintCount: Object.keys(walletContext.mintBalances).length,
    });
  }, [params, unit, walletContext.mintBalances, walletContext.trustedMintUrls.length]);

  const handleRequestMintList = () => {
    cashuLog.info('receive.mint_quote.mint_list.requested', { source: 'pill' });
    void machine.requestMintSelector();
  };

  if (!params) return null;

  return (
    <MintQuoteRoute where="receive-flow.mintQuote" onRequestMintList={handleRequestMintList} />
  );
}
