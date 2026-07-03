/**
 * @fileoverview Receive flow root route — the receive hub (method chooser).
 *
 * Part of the (receive-flow) modal group; as the first screen it shows a
 * close button. ReceiveHubScreen owns navigation and machine logic (its
 * options run through the `receiveHub` screen actions).
 *
 * Validates the `receiveHubEntry`/`unit` deep-link params at the route
 * boundary per AUDIT.md dim-5 — `receiveHubEntry` is JSON-encoded.
 */

import React from 'react';
import { Stack } from 'expo-router';
import { z } from 'zod';

import { ReceiveHubScreen } from '@/features/receive';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  receiveHubEntry: z.string().min(1).max(64_000).optional(),
  unit: z.string().max(16).optional(),
});

const ReceiveHubRoute = () => {
  const params = useRouteParams(ParamsSchema, { where: 'receive-flow.receive' });
  if (!params) return null;

  return (
    <>
      <Stack.Screen options={{ headerTitle: 'Receive' }} />
      <ReceiveHubScreen receiveHubEntry={params.receiveHubEntry} unit={params.unit || 'sat'} />
    </>
  );
};

export default ReceiveHubRoute;
