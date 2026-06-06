/**
 * @fileoverview Receive-flow Lightning receive route.
 */

import { useCallback } from 'react';

import { LightningReceiveRoute } from '@/features/receive';
import { usePaymentFlowMachine } from '@sovranbitcoin/colada/react';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { z } from 'zod';

const ParamsSchema = z.object({
  mintHistoryEntry: z.string().min(1).max(64_000),
  unit: z.string().max(16).optional(),
});

export default function LightningReceiveRouteWrapper() {
  const params = useRouteParams(ParamsSchema, { where: 'receive-flow.lightningReceive' });
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext, unit: params?.unit ?? 'sat' });
  const handleRequestMintList = useCallback(() => {
    void machine.requestMintSelector();
  }, [machine]);

  return (
    <LightningReceiveRoute
      where="receive-flow.lightningReceive"
      onRequestMintList={handleRequestMintList}
    />
  );
}
