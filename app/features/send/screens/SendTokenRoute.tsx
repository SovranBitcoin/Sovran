/**
 * @fileoverview Canonical sendToken route shell
 *
 * Single body for the three sendToken expo-router files (`app/sendToken.tsx`,
 * `app/(send-flow)/sendToken.tsx`, `app/(transactions-flow)/sendToken.tsx`).
 * Each route file is a thin pass-through that supplies the `where` log
 * scope; layout-owned `Stack.Screen` titles stay in the surrounding
 * `_layout.tsx` so we have one canonical declaration per screen name.
 *
 * Bounds the JSON-encoded `sendHistoryEntry` deep-link param at the route
 * boundary: a non-empty string of at most 64,000 characters. The shell does
 * not parse it or check what it holds. The string is passed through to
 * `SendTokenScreen`, which decodes it via `useScreenActions`; a seed that
 * does not decode comes back as the screen's error.
 * `mintWasOffline` is preserved across all three routes so reopening an
 * offline-created send from the transactions list keeps the warning
 * banner (audit 19#F-001).
 */

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { z } from 'zod';
import { SendTokenScreen } from './SendTokenScreen';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  sendHistoryEntry: z.string().min(1).max(64_000).optional(),
  createdOffline: z.string().max(16).optional(),
  mintWasOffline: z.string().max(16).optional(),
});

interface SendTokenRouteProps {
  /** Log scope for invalid-params telemetry; e.g. `'send-flow.sendToken'`. */
  where: string;
}

export function SendTokenRoute({ where }: SendTokenRouteProps) {
  const params = useRouteParams(ParamsSchema, { where });
  if (!params) return null;

  return (
    <SendTokenScreen
      sendHistoryEntry={params.sendHistoryEntry}
      createdOffline={params.createdOffline === 'true'}
      mintWasOffline={params.mintWasOffline === 'true'}
      onNavigateBack={() => router.back()}
    />
  );
}
