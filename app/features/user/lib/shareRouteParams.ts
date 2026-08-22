/**
 * Deep-link params contract shared by every Share route — the root `/share`
 * and the `(user-flow)` / `(profile-flow)` copies.
 *
 * The `type` allowlist plus the per-type shape check on `data` is a security
 * boundary, not tidiness (AUDIT.md dim-5, audit 18#F-001): without it the QR +
 * clipboard would render an attacker-crafted Lightning address under the
 * user's identity, funnelling payments away from them. Defining it once means
 * hardening it cannot miss a route.
 */
import { z } from 'zod';

import { CompressedPubkey, Hex64, LightningAddress, Npub } from '@/shared/lib/nav/routeSchemas';
import type { ShareType } from '../screens/ShareScreen';

const NpubOrHex64 = z.union([Npub, Hex64]);

/** `defaultType` is what the route falls back to when the link omits `type`. */
export function shareRouteParamsSchema(defaultType: ShareType) {
  return z
    .object({
      type: z.enum(['npub', 'profile', 'p2pk', 'lud16']).default(defaultType),
      data: z.string().min(1).max(512),
      npub: Npub.optional(),
      lud16: LightningAddress.optional(),
    })
    .superRefine((v, ctx) => {
      const dataSchema =
        v.type === 'p2pk' ? CompressedPubkey : v.type === 'lud16' ? LightningAddress : NpubOrHex64;
      const r = dataSchema.safeParse(v.data);
      if (!r.success) {
        ctx.addIssue({
          code: 'custom',
          path: ['data'],
          message: `data does not match type=${v.type}`,
        });
      }
    });
}
