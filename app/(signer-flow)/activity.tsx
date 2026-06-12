/**
 * @fileoverview Signer activity route
 *
 * Optional `clientPubkey` param pre-filters the activity list to one
 * connected app (pushed by the hub and the app-detail "View Activity" row).
 * Validated at the route boundary per AUDIT.md dim-5; the screen falls back
 * to the All filter when the param is absent.
 */

import { z } from 'zod';
import { SignerActivityScreen } from '@/features/nostrSigner';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  clientPubkey: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});

export default function SignerActivityRoute() {
  const params = useRouteParams(ParamsSchema, { where: 'signer-flow.activity' });
  if (!params) return null;
  return <SignerActivityScreen />;
}
