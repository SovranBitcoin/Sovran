/**
 * @fileoverview Signer activity-detail route
 *
 * Requires `id` — the activity entry id pushed by activity rows. Validated
 * at the route boundary per AUDIT.md dim-5 (length-bounded; entry ids are
 * internal, never attacker-derived display strings). A pruned/unknown entry
 * renders the screen's empty frame.
 */

import { z } from 'zod';
import { SignerActivityDetailScreen } from '@/features/nostrSigner';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  id: z.string().min(1).max(128),
});

export default function SignerActivityDetailRoute() {
  const params = useRouteParams(ParamsSchema, { where: 'signer-flow.activity-detail' });
  if (!params) return null;
  return <SignerActivityDetailScreen />;
}
