/**
 * @fileoverview Transactions flow sendToken route wrapper
 *
 * Part of the (transactions-flow) modal group - displays with back button.
 *
 * Validates the `sendHistoryEntry` deep-link param at the route boundary
 * per AUDIT.md dim-5 (audit 23#F-002, 18#F-002): the param is JSON-encoded
 * and was previously forwarded raw to the screen.
 */

import React from 'react';
import { router, Stack } from 'expo-router';
import { z } from 'zod';
import { SendTokenScreen } from '@/features/send';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  sendHistoryEntry: z.string().min(1).max(64_000),
});

function ModalScreen() {
  const params = useRouteParams(ParamsSchema, { where: 'transactions-flow.sendToken' });
  if (!params) return null;

  return (
    <>
      <Stack.Screen options={{ title: 'Send Ecash' }} />
      <SendTokenScreen
        sendHistoryEntry={params.sendHistoryEntry}
        onNavigateBack={() => router.back()}
      />
    </>
  );
}

export default ModalScreen;
