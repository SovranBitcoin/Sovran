/**
 * @fileoverview Legacy mintQuote route dispatcher
 *
 * `mintQuote` is the internal colada operation contract. User-facing
 * routes are rail-specific (`lightningReceive` / `onchainReceive`), but this
 * dispatcher keeps older links and transaction references valid.
 */

import React from 'react';
import { z } from 'zod';
import { paymentLog } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { isOnchainMintQuoteParam } from '../lib/mintQuotePresentation';
import { LightningReceiveRoute } from './LightningReceiveRoute';
import { OnchainReceiveRoute } from './OnchainReceiveRoute';

const ParamsSchema = z.object({
  mintHistoryEntry: z.string().min(1).max(64_000),
  unit: z.string().max(16).optional(),
});

interface MintQuoteRouteProps {
  /** Log scope for invalid-params telemetry; e.g. `'receive-flow.mintQuote'`. */
  where: string;
  /**
   * Mint-pill callback. Wired by the active receive-flow wrapper
   * through `usePaymentFlowMachine`; left undefined for read-only
   * re-entries (standalone, transactions-flow).
   */
  onRequestMintList?: () => void;
}

export function MintQuoteRoute({ where, onRequestMintList }: MintQuoteRouteProps) {
  const params = useRouteParams(ParamsSchema, { where });
  if (!params) return null;
  const isOnchain = isOnchainMintQuoteParam(params.mintHistoryEntry);
  paymentLog.info('receive.mint_quote.route_dispatch', {
    where,
    isOnchain,
    mintHistoryEntryLength: params.mintHistoryEntry.length,
    unit: params.unit ?? null,
    hasMintListCallback: !!onRequestMintList,
  });

  return isOnchain ? (
    <OnchainReceiveRoute where={where} onRequestMintList={onRequestMintList} />
  ) : (
    <LightningReceiveRoute where={where} onRequestMintList={onRequestMintList} />
  );
}
