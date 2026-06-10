/**
 * @fileoverview Signer per-app permission editor route
 *
 * Requires `clientPubkey` (64-hex) — pushed by the hub's connected-apps
 * list. Validated at the route boundary per AUDIT.md dim-5. The header is
 * owned by the SCREEN (scroll-linked identity crossfade via
 * `useScreenOptions`); the layout's empty title covers the first frame.
 */

import { z } from 'zod';
import { SignerAppDetailScreen } from '@/features/nostrSigner';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  clientPubkey: z.string().regex(/^[0-9a-f]{64}$/),
});

export default function SignerAppDetailRoute() {
  const params = useRouteParams(ParamsSchema, { where: 'signer-flow.app' });

  if (!params) return null;

  return <SignerAppDetailScreen />;
}
