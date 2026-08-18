/**
 * @fileoverview Canonical Lightning receive route shell
 *
 * Single body for the Lightning receive expo-router files. The active
 * (receive-flow) wrapper threads the mint-pill callbacks through the
 * payment machine so the user can swap mints mid-flow; standalone and
 * transactions-flow re-entries leave them undefined so `LightningReceiveScreen`
 * renders the entry read-only.
 *
 * Validates the JSON-encoded `mintHistoryEntry` deep-link param at the
 * route boundary per AUDIT.md dim-5 (audit 23#F-002): unguarded
 * `JSON.parse(...)` is the crash + invoice-spoofing surface. The
 * validated string is passed through to LightningReceiveScreen, which decodes
 * via `useScreenActions`.
 */

import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { z } from 'zod';
import { LightningReceiveScreen } from './LightningReceiveScreen';
import { paymentLog } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  mintHistoryEntry: z.string().min(1).max(64_000),
  unit: z.string().max(16).optional(),
});

interface LightningReceiveRouteProps {
  /** Log scope for invalid-params telemetry; e.g. `'receive-flow.lightningReceive'`. */
  where: string;
  /**
   * Mint-pill callback. Wired by the active receive-flow wrapper
   * through `usePaymentFlowMachine`; left undefined for read-only
   * re-entries (standalone, transactions-flow).
   */
  onRequestMintList?: () => void;
}

export function LightningReceiveRoute({ where, onRequestMintList }: LightningReceiveRouteProps) {
  const params = useRouteParams(ParamsSchema, { where });
  const screenOptions = useMemo(() => ({ title: 'Receive Lightning' }), []);
  if (!params) return null;
  paymentLog.info('receive.lightning.route_ready', {
    where,
    mintHistoryEntryLength: params.mintHistoryEntry.length,
    unit: params.unit ?? null,
    hasMintListCallback: !!onRequestMintList,
  });

  return (
    <>
      <Stack.Screen options={screenOptions} />
      <LightningReceiveScreen
        key={params.mintHistoryEntry}
        mintHistoryEntry={params.mintHistoryEntry}
        onRequestMintList={onRequestMintList}
      />
    </>
  );
}
