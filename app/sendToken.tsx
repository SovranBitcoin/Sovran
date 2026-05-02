/**
 * @fileoverview Standalone sendToken route wrapper
 *
 * Used for direct navigation and deep linking. Validates the
 * `sendHistoryEntry` param at the route boundary per AUDIT.md dim-5
 * (audit 23#F-002, 18#F-002): the param is JSON-encoded and was previously
 * forwarded raw to the screen, which `JSON.parse`s it — an attacker-crafted
 * link could crash the screen or spoof a send history entry.
 */

import React from 'react';
import { router } from 'expo-router';
import { z } from 'zod';
import { SendTokenScreen } from '@/features/send';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  sendHistoryEntry: z.string().min(1).max(64_000),
});

function ModalScreen() {
  const params = useRouteParams(ParamsSchema, { where: 'app.sendToken' });
  if (!params) return null;

  return (
    <SendTokenScreen
      sendHistoryEntry={params.sendHistoryEntry}
      onNavigateBack={() => router.back()}
    />
  );
}

export default ModalScreen;
