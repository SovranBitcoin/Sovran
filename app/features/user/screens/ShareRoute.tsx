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

export default function ShareRoute() {
  const foreground = useThemeColor('foreground');
  const parsed = useRouteParams(ParamsSchema, { where: 'profile.share' });
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
