/**
 * The route boundary shared by the Lightning and Onchain receive shells.
 *
 * Validates the `mintHistoryEntry`/`unit` params once. A route that opts into
 * `editableMint` (the receive flow) also binds the payment-flow machine to the
 * route's explicit unit, logs a ready event carrying the wallet-context shape,
 * and gets the mint-pill callback; history and standalone routes stay
 * read-only and unbound.
 */
import { useCallback, useEffect } from 'react';
import { z } from 'zod';
import { useColadaContext, usePaymentFlowMachine } from 'wallet/react';

import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { cashuLog } from '@/shared/lib/logger';

const ParamsSchema = z.object({
  mintHistoryEntry: z.string().min(1).max(64_000),
  unit: z.string().max(16).optional(),
});
type ReceiveRailParams = z.infer<typeof ParamsSchema>;
type ReceiveRail = 'lightning' | 'onchain';

export function useReceiveRailRoute(rail: ReceiveRail, where: string, editableMint: boolean) {
  const params = useRouteParams(ParamsSchema, { where });
  const { machine } = useColadaContext();
  const onRequestMintList = useCallback(() => {
    // receive.lightning.mint_list.requested, receive.onchain.mint_list.requested
    cashuLog.info(`receive.${rail}.mint_list.requested`, { source: 'pill' });
    void machine.requestMintSelector();
  }, [machine, rail]);

  return {
    params,
    onRequestMintList: editableMint ? onRequestMintList : undefined,
    // Rendered after the screen so its effects still run after the screen's.
    flowBinding: editableMint ? (
      <ReceiveRailFlowBinding rail={rail} where={where} params={params} />
    ) : null,
  };
}

function ReceiveRailFlowBinding({
  rail,
  where,
  params,
}: {
  rail: ReceiveRail;
  where: string;
  params: ReceiveRailParams | null;
}) {
  const walletContext = useWalletContext();
  // Explicit unit binding only when the route carries one — a 'sat' fallback
  // here would override the app's live active unit for flow resets.
  usePaymentFlowMachine({
    walletContext,
    ...(params?.unit ? { unit: params.unit } : {}),
  });

  useEffect(() => {
    // receive.lightning.route.ready, receive.onchain.route.ready
    cashuLog.info(`receive.${rail}.route.ready`, {
      where,
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
    rail,
    where,
  ]);

  return null;
}
