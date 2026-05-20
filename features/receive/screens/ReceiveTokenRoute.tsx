/**
 * @fileoverview Canonical receiveToken route shell
 *
 * Single body for the three receiveToken expo-router files. Each route
 * file is a thin pass-through that supplies the `where` log scope;
 * layout-owned `Stack.Screen` titles stay in the surrounding
 * `_layout.tsx` so we have one canonical declaration per screen name.
 *
 * Validates the JSON-encoded `receiveHistoryEntry` deep-link param at
 * the route boundary per AUDIT.md dim-5 (audit 23#F-002, 18#F-002): the
 * param is `JSON.parse`d by the screen, so unguarded forwarding crashes
 * on malformed input or renders a spoofed receive entry.
 */

import React from 'react';
import { router } from 'expo-router';
import { z } from 'zod';
import { ReceiveTokenScreen } from './ReceiveTokenScreen';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  receiveHistoryEntry: z.string().min(1).max(64_000),
});

interface ReceiveTokenRouteProps {
  /** Log scope for invalid-params telemetry; e.g. `'receive-flow.receiveToken'`. */
  where: string;
}

export function ReceiveTokenRoute({ where }: ReceiveTokenRouteProps) {
  const params = useRouteParams(ParamsSchema, { where });
  if (!params) return null;

  return (
    <ReceiveTokenScreen
      receiveHistoryEntry={params.receiveHistoryEntry}
      onNavigateBack={() => router.back()}
    />
  );
}
