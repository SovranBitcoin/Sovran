/**
 * @fileoverview Standalone Share route wrapper
 *
 * Validates deep-link params at the route boundary per AUDIT.md dim-5
 * (audit 18#F-001): without an allowlist on `type` and a shape check on
 * `data` the QR + clipboard would render attacker-crafted Lightning
 * addresses under the user's identity, funnelling payments away from
 * the user.
 */

import React, { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { z } from 'zod';
import { Hex64 } from '@sovranbitcoin/schemas';

import { ShareScreen, SHARE_CONFIGS, ShareType } from '@/features/user';
import { useScreenOptions } from '@/shared/ui/composed/Screen';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const COMPRESSED_PUBKEY = /^0[23][0-9a-f]{64}$/;
const NPUB = /^npub1[02-9ac-hj-np-z]{58,}$/;
const LUD16 = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,}$/;

const npubData = z.string().regex(NPUB, 'invalid npub').or(Hex64);
const p2pkData = z.string().regex(COMPRESSED_PUBKEY, 'invalid p2pk');
const lud16Data = z.string().regex(LUD16, 'invalid lightning address').max(320);

const ParamsSchema = z
  .object({
    type: z.enum(['npub', 'profile', 'p2pk', 'lud16']).default('profile'),
    data: z.string().min(1).max(512),
    npub: z.string().regex(NPUB).optional(),
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

function ShareRoute() {
  const parsed = useRouteParams(ParamsSchema, { where: 'app.share' });
  const type = (parsed?.type ?? 'profile') as ShareType;
  const [headerTitle, setHeaderTitle] = useState<string>(SHARE_CONFIGS[type]?.title ?? 'Share');

  const handleTitleChange = useCallback((title: string) => {
    setHeaderTitle(title);
  }, []);

  useScreenOptions(
    () => ({
      headerTitle,
      headerLeft: () => (
        <ScreenHeaderAction icon="material-symbols:close-rounded" onPress={() => router.back()} />
      ),
    }),
    [headerTitle]
  );

  if (!parsed) return null;

  return (
    <ShareScreen
      type={type}
      data={parsed.data}
      npub={parsed.npub}
      onTitleChange={handleTitleChange}
    />
  );
}

export default ShareRoute;
