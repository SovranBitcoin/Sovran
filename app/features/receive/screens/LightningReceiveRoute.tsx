/**
 * @fileoverview Canonical Lightning receive route shell
 *
 * Single body for the Lightning receive expo-router files. The active
 * (receive-flow) route asks for `editableMint`, which binds the payment
 * machine and wires the mint pill so the user can swap mints mid-flow;
 * standalone and transactions-flow re-entries omit it, so
 * `LightningReceiveScreen` renders the entry read-only.
 *
 * Validates the JSON-encoded `mintHistoryEntry` deep-link param at the
 * route boundary per AUDIT.md dim-5 (audit 23#F-002): unguarded
 * `JSON.parse(...)` is the crash + invoice-spoofing surface. The
 * validated string is passed through to LightningReceiveScreen, which decodes
 * via `useScreenActions`.
 */

import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { LightningReceiveScreen } from './LightningReceiveScreen';
import { useReceiveRailRoute } from '@/features/receive/hooks/useReceiveRailRoute';
import { paymentLog } from '@/shared/lib/logger';

interface LightningReceiveRouteProps {
  /** Log scope for invalid-params telemetry; e.g. `'receive-flow.lightningReceive'`. */
  where: string;
  /** The receive flow's mint pill swaps mints; omitted for read-only re-entries. */
  editableMint?: boolean;
}

export function LightningReceiveRoute({ where, editableMint = false }: LightningReceiveRouteProps) {
  const { params, onRequestMintList, flowBinding } = useReceiveRailRoute(
    'lightning',
    where,
    editableMint
  );
  const screenOptions = useMemo(() => ({ title: 'Receive Lightning' }), []);
  if (!params) return flowBinding;
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
      {flowBinding}
    </>
  );
}
