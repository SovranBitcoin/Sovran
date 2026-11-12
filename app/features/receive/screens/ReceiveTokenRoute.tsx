/**
 * @fileoverview Canonical receiveToken route shell
 *
 * Single body for the three receiveToken expo-router files. Each route
 * file is a thin pass-through that supplies the `where` log scope;
 * layout-owned `Stack.Screen` titles stay in the surrounding
 * `_layout.tsx` so we have one canonical declaration per screen name.
 *
 * Bounds the JSON-encoded `receiveHistoryEntry` deep-link param at the
 * route boundary: a non-empty string of at most 64,000 characters. The shell
 * does not parse it or check what it holds. The string is passed through to
 * `ReceiveTokenScreen`, which decodes it via `useScreenActions`; a seed that
 * does not decode comes back as the screen's error.
 */

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

  return <ReceiveTokenScreen receiveHistoryEntry={params.receiveHistoryEntry} />;
}
