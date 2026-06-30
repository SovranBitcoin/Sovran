/**
 * @fileoverview Receive-flow Onchain receive route.
 */

import { useCallback, useEffect } from 'react';

import { OnchainReceiveRoute } from '@/features/receive';
import { usePaymentFlowMachine } from '@sovranbitcoin/colada/react';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { z } from 'zod';
import { cashuLog } from '@/shared/lib/logger';

const ParamsSchema = z.object({
  mintHistoryEntry: z.string().min(1).max(64_000),
  unit: z.string().max(16).optional(),
});

export default function OnchainReceiveRouteWrapper() {
  const params = useRouteParams(ParamsSchema, { where: 'receive-flow.onchainReceive' });
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext, unit: params?.unit ?? 'sat' });
  useEffect(() => {
    cashuLog.info('receive.onchain.route.ready', {
      where: 'receive-flow.onchainReceive',
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
    cashuLog.info('receive.onchain.mint_list.requested', { source: 'pill' });
    void machine.requestMintSelector();
  }, [machine]);

  return (
    <OnchainReceiveRoute
      where="receive-flow.onchainReceive"
      onRequestMintList={handleRequestMintList}
    />
  );
}
