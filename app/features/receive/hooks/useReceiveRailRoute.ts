/**
 * Shared wiring for the two standing-rail receive routes,
 * `(receive-flow)/lightningReceive` and `(receive-flow)/onchainReceive`.
 *
 * Both validate the same `mintHistoryEntry`/`unit` params at the route
 * boundary, bind the payment-flow machine to the route's explicit unit, log a
 * ready event carrying the same wallet-context shape, and open the mint
 * selector from the mint pill. Only the route id and the log event names
 * differ, so callers pass those as literals — keeping every event name
 * greppable from the route file it belongs to.
 */
import { useCallback, useEffect } from 'react';
import { z } from 'zod';
import { usePaymentFlowMachine } from 'wallet/react';

import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { cashuLog } from '@/shared/lib/logger';

const ParamsSchema = z.object({
  mintHistoryEntry: z.string().min(1).max(64_000),
  unit: z.string().max(16).optional(),
});

interface ReceiveRailRouteOptions {
  /** Route id used for param-validation and log correlation. */
  where: string;
  /** Logged once the route has params + wallet context. */
  readyEvent: string;
  /** Logged when the mint pill asks for the mint selector. */
  mintListEvent: string;
}

export function useReceiveRailRoute({ where, readyEvent, mintListEvent }: ReceiveRailRouteOptions) {
  const params = useRouteParams(ParamsSchema, { where });
  const walletContext = useWalletContext();
  // Explicit unit binding only when the route carries one — a 'sat' fallback
  // here would override the app's live active unit for flow resets.
  const machine = usePaymentFlowMachine({
    walletContext,
    ...(params?.unit ? { unit: params.unit } : {}),
  });

  useEffect(() => {
    cashuLog.info(readyEvent, {
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
    readyEvent,
    where,
  ]);

  const onRequestMintList = useCallback(() => {
    cashuLog.info(mintListEvent, { source: 'pill' });
    void machine.requestMintSelector();
  }, [machine, mintListEvent]);

  return { onRequestMintList };
}
