/**
 * @fileoverview Send flow sendToken route wrapper
 *
 * Part of the (send-flow) modal group - displays with back button.
 * The token is created by the confirmSend handler before navigation.
 * This screen only renders the pre-built SendHistoryEntry.
 *
 * Validates deep-link params at the route boundary per AUDIT.md dim-5
 * (audit 23#F-002): `sendHistoryEntry` is a JSON-encoded blob the screen
 * `JSON.parse`s — an attacker-crafted deep link would otherwise crash the
 * screen or render a spoofed entry.
 */

import React from 'react';
import { router, Stack } from 'expo-router';
import { z } from 'zod';
import { SendTokenScreen } from '@/features/send';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  sendHistoryEntry: z.string().min(1).max(64_000).optional(),
  mintWasOffline: z.string().max(16).optional(),
});

function ModalScreen() {
  const params = useRouteParams(ParamsSchema, { where: 'send-flow.sendToken' });
  if (!params) return null;

  return (
    <>
      <Stack.Screen options={{ title: 'Send Ecash' }} />
      <SendTokenScreen
        sendHistoryEntry={params.sendHistoryEntry}
        mintWasOffline={params.mintWasOffline === 'true'}
        onNavigateBack={() => router.back()}
      />
    </>
  );
}

export default ModalScreen;
