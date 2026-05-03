/**
 * @fileoverview User Flow Share Screen
 *
 * Share user profile via QR code within the user flow. Uses the
 * ShareScreen component with the type from the deep-link param.
 *
 * Deep-link params are validated with Zod at the route boundary per
 * AUDIT.md dim-5. The share view renders `data` in a QR plus copies it to
 * the clipboard, so a missing `type`/`data` shape check lets an attacker
 * craft a link like `sovran://(user-flow)/share?type=lud16&data=evil@attacker`
 * that funnels payments away from the user (audit 18#F-001). Each
 * `type` is paired with a shape check on `data` so the QR can only render
 * payloads that actually match the advertised type.
 */

import React, { useCallback, useState } from 'react';
import { Stack } from 'expo-router';
import { z } from 'zod';

import { ShareScreen, SHARE_CONFIGS, ShareType } from '@/features/user';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { CompressedPubkey, Hex64, LightningAddress, Npub } from '@/shared/lib/nav/routeSchemas';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const NpubOrHex64 = z.union([Npub, Hex64]);

const ParamsSchema = z
  .object({
    type: z.enum(['npub', 'profile', 'p2pk', 'lud16']).default('npub'),
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

function SharePage() {
  const foreground = useThemeColor('foreground');
  const parsed = useRouteParams(ParamsSchema, { where: 'user-flow.share' });
  const type = (parsed?.type ?? 'npub') as ShareType;
  const [headerTitle, setHeaderTitle] = useState<string>(
    SHARE_CONFIGS[type]?.title ?? 'Share Profile'
  );
  const handleTitleChange = useCallback((title: string) => setHeaderTitle(title), []);

  if (!parsed) return null;

  return (
    <>
      <Stack.Screen
        options={{
          title: headerTitle,
          headerTitleStyle: { color: foreground },
        }}
      />
      <ShareScreen
        type={type}
        data={parsed.data}
        npub={parsed.npub}
        lud16={parsed.lud16}
        onTitleChange={handleTitleChange}
      />
    </>
  );
}

export default SharePage;
