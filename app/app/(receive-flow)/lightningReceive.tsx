/**
 * @fileoverview Receive-flow Lightning receive route.
 */

import { useCallback, useEffect } from 'react';

import { LightningReceiveRoute } from '@/features/receive';
import { usePaymentFlowMachine } from 'wallet/react';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { z } from 'zod';
import { cashuLog } from '@/shared/lib/logger';

const ParamsSchema = z.object({
  mintHistoryEntry: z.string().min(1).max(64_000),
  unit: z.string().max(16).optional(),
});

export default function LightningReceiveRouteWrapper() {
  const params = useRouteParams(ParamsSchema, { where: 'receive-flow.lightningReceive' });
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext, unit: params?.unit ?? 'sat' });
  useEffect(() => {
    cashuLog.info('receive.lightning.route.ready', {
      where: 'receive-flow.lightningReceive',
      unit: params?.unit ?? 'sat',
      hasEntry: !!params?.mintHistoryEntry,
      entryLength: params?.mintHistoryEntry?.length ?? 0,
      trustedMintCount: walletContext.trustedMintUrls.length,
      balanceMintCount: Object.keys(walletContext.mintBalances).length,
    });
  }, [
    params?.mintHistoryEntry,
    params?.unit,
    walletContext.mintBalances,
    walletContext.trustedMintUrls.length,
  ]);
  const handleRequestMintList = useCallback(() => {
    cashuLog.info('receive.lightning.mint_list.requested', { source: 'pill' });
    void machine.requestMintSelector();
  }, [machine]);

  return (
    <LightningReceiveRoute
      where="receive-flow.lightningReceive"
      onRequestMintList={handleRequestMintList}
    />
  );
}
