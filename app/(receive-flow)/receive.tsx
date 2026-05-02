/**
 * @fileoverview Receive flow receive route wrapper
 *
 * Part of the (receive-flow) modal group - displays with back button.
 * ReceiveScreen owns navigation and machine logic.
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

const EcashLightningReceiver = () => {
  const params = useRouteParams(ParamsSchema, { where: 'receive-flow.receive' });
  if (!params) return null;

  return (
    <>
      <Stack.Screen options={{ headerTitle: 'Receive' }} />
      <ReceiveScreen receiveEntry={params.receiveEntry} unit={params.unit || 'sat'} />
    </>
  );
};

export default EcashLightningReceiver;
