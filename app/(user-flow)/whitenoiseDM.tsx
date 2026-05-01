/**
 * @fileoverview User Flow White Noise DM Screen
 *
 * Part of the (user-flow) modal group. Audit 18-F-002 requires every
 * (user-flow) route to validate useLocalSearchParams with zod before use.
 */

import React, { useEffect } from 'react';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { z } from 'zod';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { WhitenoiseDMScreen } from '@/features/whitenoise/screens/WhitenoiseDMScreen';
import { log } from '@/shared/lib/logger';

const ParamsSchema = z.object({
  pubkey: z.string().regex(/^[0-9a-f]{64}$/, 'pubkey must be 64-hex'),
});

export default function WhitenoiseDMPage() {
  const foreground = useThemeColor('foreground');
  const raw = useLocalSearchParams<{ pubkey?: string }>();
  const parsed = ParamsSchema.safeParse(raw);

  useEffect(() => {
    if (!parsed.success) {
      log.warn('whitenoise.route.invalid_params', {
        issues: parsed.error.issues.map((i) => i.message),
      });
      router.back();
    }
  }, [parsed.success, parsed]);

  if (!parsed.success) return null;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'White Noise',
          headerTitleStyle: { color: foreground },
        }}
      />
      <WhitenoiseDMScreen pubkey={parsed.data.pubkey} />
    </>
  );
}
