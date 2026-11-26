/**
 * @fileoverview Swap route: one grouped swap, opened from history or a toast.
 *
 * Validates the `groupId` deep-link param at the route boundary per
 * AUDIT.md dim-5 — `groupId` is used as a swap-store map key downstream.
 */

import { Stack } from 'expo-router';
import { z } from 'zod';
import { SwapTransactionScreen } from '@/features/transactions';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  groupId: z.string().min(1).max(256).optional(),
});

function ModalScreen() {
  const params = useRouteParams(ParamsSchema, { where: 'app.swap' });
  if (!params) return null;

  return (
    <>
      <Stack.Screen options={{ title: 'Swap' }} />
      <SwapTransactionScreen groupId={params.groupId} />
    </>
  );
}

export default ModalScreen;
