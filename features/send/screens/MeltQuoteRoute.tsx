/**
 * @fileoverview Canonical meltQuote route shell
 *
 * Single body for the three meltQuote expo-router files. The active
 * (send-flow) wrapper threads the mint-pill callbacks through the
 * payment machine so the user can swap mints mid-flow; standalone and
 * transactions-flow re-entries leave them undefined so `MeltQuoteScreen`
 * renders the entry read-only.
 *
 * Validates the JSON-encoded `meltHistoryEntry` deep-link param at the
 * route boundary per AUDIT.md dim-5 (audit 23#F-002): the param is
 * `JSON.parse`d by the screen, so unguarded forwarding crashes on
 * malformed input or renders a spoofed melt entry.
 */

import React from 'react';
import { router } from 'expo-router';
import { z } from 'zod';
import { MeltQuoteScreen } from './MeltQuoteScreen';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

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

export function MeltQuoteRoute({ where, onRequestMintList }: MeltQuoteRouteProps) {
  const params = useRouteParams(ParamsSchema, { where });
  if (!params) return null;

  return (
    <MeltQuoteScreen
      key={params.meltHistoryEntry}
      meltHistoryEntry={params.meltHistoryEntry}
      onCancel={() => {
        router.dismissTo('/');
      }}
      onRequestMintList={onRequestMintList}
    />
  );
}
