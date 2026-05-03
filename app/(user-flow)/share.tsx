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
 * `type` is paired with a regex on `data` so the QR can only render
 * payloads that actually match the advertised type.
 */

import React, { useCallback, useState } from 'react';
import { Stack } from 'expo-router';
import { z } from 'zod';
import { Hex64 } from '@sovranbitcoin/schemas';
import { ShareScreen, SHARE_CONFIGS, ShareType } from '@/features/user';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const COMPRESSED_PUBKEY = /^0[23][0-9a-f]{64}$/;
const NPUB = /^npub1[02-9ac-hj-np-z]{58,}$/;
const LUD16 = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,}$/;

const npubData = z.string().regex(NPUB, 'invalid npub').or(Hex64);
const p2pkData = z.string().regex(COMPRESSED_PUBKEY, 'invalid p2pk');
const lud16Data = z.string().regex(LUD16, 'invalid lightning address').max(320);

const ParamsSchema = z
  .object({
    type: z.enum(['npub', 'profile', 'p2pk', 'lud16']).default('npub'),
    data: z.string().min(1).max(512),
    npub: z.string().regex(NPUB).optional(),
    lud16: z.string().regex(LUD16).max(320).optional(),
  })
  .superRefine((v, ctx) => {
    const dataSchema = v.type === 'p2pk' ? p2pkData : v.type === 'lud16' ? lud16Data : npubData;
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
