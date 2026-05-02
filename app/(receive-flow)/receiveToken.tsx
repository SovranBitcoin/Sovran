/**
 * @fileoverview Receive flow receiveToken route wrapper
 *
 * Part of the (receive-flow) modal group - displays with back button.
 *
 * Validates the `receiveHistoryEntry` deep-link param at the route
 * boundary per AUDIT.md dim-5 (audit 23#F-002, 18#F-002): the param is
 * JSON-encoded and was previously forwarded raw to the screen.
 */

import React from 'react';
import { router, Stack } from 'expo-router';
import { z } from 'zod';
import { ReceiveTokenScreen } from '@/features/receive';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  receiveHistoryEntry: z.string().min(1).max(64_000),
});

function ModalScreen() {
  const params = useRouteParams(ParamsSchema, { where: 'receive-flow.receiveToken' });
  if (!params) return null;

  return (
    <>
      <Stack.Screen options={{ title: 'Receive Ecash' }} />
      <ReceiveTokenScreen
        receiveHistoryEntry={params.receiveHistoryEntry}
        onNavigateBack={() => router.back()}
      />
    </>
  );
}

export default ModalScreen;
