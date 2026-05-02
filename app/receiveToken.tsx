/**
 * @fileoverview Standalone receiveToken route wrapper
 *
 * Used for direct navigation and deep linking. Validates the
 * `receiveHistoryEntry` param at the route boundary per AUDIT.md dim-5
 * (audit 23#F-002, 18#F-002): the param is JSON-encoded and was previously
 * forwarded raw to the screen, which `JSON.parse`s it — an attacker-crafted
 * link could crash the screen on malformed input or render a spoofed
 * receive history entry.
 */

import React from 'react';
import { router } from 'expo-router';
import { z } from 'zod';
import { ReceiveTokenScreen } from '@/features/receive';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  receiveHistoryEntry: z.string().min(1).max(64_000),
});

function ModalScreen() {
  const params = useRouteParams(ParamsSchema, { where: 'app.receiveToken' });
  if (!params) return null;

  return (
    <ReceiveTokenScreen
      receiveHistoryEntry={params.receiveHistoryEntry}
      onNavigateBack={() => router.back()}
    />
  );
}

export default ModalScreen;
