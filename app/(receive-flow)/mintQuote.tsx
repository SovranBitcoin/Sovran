/**
 * @fileoverview Receive-flow mintQuote route — final screen of an
 * active Lightning receive. The route body and zod schema live on
 * `MintQuoteRoute`; this wrapper threads the mint-pill callbacks through
 * the active payment machine so the user can swap mints mid-flow.
 * `Stack.Screen` title comes from `(receive-flow)/_layout.tsx`.
 */

import React, { useCallback } from 'react';
import { z } from 'zod';

import { MintQuoteRoute } from '@/features/receive';
import { usePaymentFlowMachine } from 'coco-payment-ux/react';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

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

  const handleRequestMintList = useCallback(() => {
    void machine.requestMintSelector();
  }, [machine]);

  if (!params) return null;

  return (
    <MintQuoteRoute where="receive-flow.mintQuote" onRequestMintList={handleRequestMintList} />
  );
}
