/**
 * @fileoverview Receive QR display route — the standing receive rails
 * (Unified / Lightning / Onchain / Cashu tabs).
 *
 * Pushed from the receive hub's "QR Display" option (`machine.showReceiveQr`
 * → the Colada `navigateToReceive` step). ReceiveScreen owns navigation and
 * machine logic.
 *
 * Validates the `receiveEntry`/`unit` deep-link params at the route
 * boundary per AUDIT.md dim-5 — `receiveEntry` is JSON-encoded.
 */

import React from 'react';
import { Stack } from 'expo-router';
import { z } from 'zod';

import { ReceiveScreen } from '@/features/receive';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  receiveEntry: z.string().min(1).max(64_000).optional(),
  unit: z.string().max(16).optional(),
});

const ReceiveQrDisplayRoute = () => {
  const params = useRouteParams(ParamsSchema, { where: 'receive-flow.qrDisplay' });
  if (!params) return null;

  return (
    <>
      <Stack.Screen options={{ headerTitle: 'Receive' }} />
      <ReceiveScreen receiveEntry={params.receiveEntry} unit={params.unit || 'sat'} />
    </>
  );
};

export default ReceiveQrDisplayRoute;
