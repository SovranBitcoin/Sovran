/**
 * @fileoverview Receive-flow Onchain receive route.
 */

import { useCallback } from 'react';

import { OnchainReceiveRoute } from '@/features/receive';
import { usePaymentFlowMachine } from 'colada/react';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { z } from 'zod';

const ParamsSchema = z.object({
  mintHistoryEntry: z.string().min(1).max(64_000),
  unit: z.string().max(16).optional(),
});

export default function OnchainReceiveRouteWrapper() {
  const params = useRouteParams(ParamsSchema, { where: 'receive-flow.onchainReceive' });
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext, unit: params?.unit ?? 'sat' });
  const handleRequestMintList = useCallback(() => {
    void machine.requestMintSelector();
  }, [machine]);

  return (
    <OnchainReceiveRoute
      where="receive-flow.onchainReceive"
      onRequestMintList={handleRequestMintList}
    />
  );
}
