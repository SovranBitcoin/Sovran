/**
 * @fileoverview User Flow White Noise DM Screen
 *
 * Part of the (user-flow) modal group. Validates the deep-link `pubkey`
 * param at the route boundary via the shared useRouteParams seam per
 * AUDIT.md dim-5.
 */

import React from 'react';
import { Stack } from 'expo-router';
import { z } from 'zod';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { WhitenoiseDMScreen } from '@/features/whitenoise/screens/WhitenoiseDMScreen';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  pubkey: z.string().regex(/^[0-9a-f]{64}$/, 'pubkey must be 64-hex'),
});

export default function WhitenoiseDMPage() {
  const foreground = useThemeColor('foreground');
  const params = useRouteParams(ParamsSchema, { where: 'user-flow.whitenoiseDM' });
  if (!params) return null;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'White Noise',
          headerTitleStyle: { color: foreground },
        }}
      />
      <WhitenoiseDMScreen pubkey={params.pubkey} />
    </>
  );
}
