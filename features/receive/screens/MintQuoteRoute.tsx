/**
 * @fileoverview Canonical mintQuote route shell
 *
 * Single body for the three mintQuote expo-router files. The active
 * (receive-flow) wrapper threads the mint-pill callbacks through the
 * payment machine so the user can swap mints mid-flow; standalone and
 * transactions-flow re-entries leave them undefined so `MintQuoteScreen`
 * renders the entry read-only.
 *
 * Validates the JSON-encoded `mintHistoryEntry` deep-link param at the
 * route boundary per AUDIT.md dim-5 (audit 23#F-002): unguarded
 * `JSON.parse(...)` is the crash + invoice-spoofing surface. The
 * validated string is passed through to MintQuoteScreen, which decodes
 * via `useScreenActions`.
 */

import React from 'react';
import { z } from 'zod';
import { MintQuoteScreen } from './MintQuoteScreen';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

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

  return (
    <MintQuoteScreen
      key={params.mintHistoryEntry}
      mintHistoryEntry={params.mintHistoryEntry}
      onRequestMintList={onRequestMintList}
    />
  );
}
