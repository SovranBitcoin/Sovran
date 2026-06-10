/**
 * @fileoverview Signer per-app permission editor route
 *
 * Requires `clientPubkey` (64-hex) — pushed by the hub's connected-apps
 * list. Validated at the route boundary per AUDIT.md dim-5. The header
 * title is the connected app's display name (length-bounded by
 * `appDisplayName`; falls back to "Unnamed app").
 */

import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { z } from 'zod';
import {
  appDisplayName,
  SignerAppDetailScreen,
  useNip46ConnectionsStore,
} from '@/features/nostrSigner';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  clientPubkey: z.string().regex(/^[0-9a-f]{64}$/),
});

export default function SignerAppDetailRoute() {
  const params = useRouteParams(ParamsSchema, { where: 'signer-flow.app' });
  const clientPubkey = params?.clientPubkey;
  const app = useNip46ConnectionsStore((s) =>
    clientPubkey === undefined ? undefined : s.apps[clientPubkey]
  );
  const screenOptions = useMemo(() => ({ title: appDisplayName(app) }), [app]);

  if (!params) return null;

  return (
    <>
      <Stack.Screen options={screenOptions} />
      <SignerAppDetailScreen />
    </>
  );
}
