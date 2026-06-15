/**
 * @fileoverview Legacy meltQuote route dispatcher
 *
 * `meltQuote` is the internal colada operation contract. User-facing
 * routes are rail-specific (`lightningSend` / `onchainSend`), but this
 * dispatcher keeps older links and transaction references valid.
 */

import React from 'react';
import { z } from 'zod';
import type { HistoryEntry } from '@cashu/coco-core';

import { getOnchainMeltAddress } from '@/shared/lib/cashu/onchainMelt';
import { paymentLog } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { LightningSendRoute } from './LightningSendRoute';
import { OnchainSendRoute } from './OnchainSendRoute';

const ParamsSchema = z.object({
  meltHistoryEntry: z.string().min(1).max(64_000).optional(),
});

interface MeltQuoteRouteProps {
  /** Log scope for invalid-params telemetry; e.g. `'send-flow.meltQuote'`. */
  where: string;
  /**
   * Mint-pill callback. Wired by the active send-flow wrapper through
   * `usePaymentFlowMachine`; left undefined for read-only re-entries
   * (standalone, transactions-flow).
   */
  onRequestMintList?: () => void;
}

function classifyMeltParam(meltHistoryEntry: string | null | undefined): {
  isOnchain: boolean;
  hasEntry: boolean;
  parsed: boolean;
  addressPresent: boolean;
} {
  if (!meltHistoryEntry) {
    return { isOnchain: false, hasEntry: false, parsed: false, addressPresent: false };
  }

  try {
    const addressPresent = !!getOnchainMeltAddress(JSON.parse(meltHistoryEntry) as HistoryEntry);
    return { isOnchain: addressPresent, hasEntry: true, parsed: true, addressPresent };
  } catch {
    return { isOnchain: false, hasEntry: true, parsed: false, addressPresent: false };
  }
}

export function MeltQuoteRoute({ where, onRequestMintList }: MeltQuoteRouteProps) {
  const params = useRouteParams(ParamsSchema, { where });
  if (!params) return null;
  const classification = classifyMeltParam(params.meltHistoryEntry);
  paymentLog.info('send.melt_quote.route_dispatch', {
    where,
    ...classification,
    meltHistoryEntryLength: params.meltHistoryEntry?.length ?? 0,
    hasMintListCallback: !!onRequestMintList,
  });

  return classification.isOnchain ? (
    <OnchainSendRoute where={where} />
  ) : (
    <LightningSendRoute where={where} onRequestMintList={onRequestMintList} />
  );
}
