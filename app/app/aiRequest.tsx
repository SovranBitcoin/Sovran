/**
 * @fileoverview AI-request route: one grouped AI request, opened from history.
 *
 * `groupId` is a deep-link param used as a lookup key downstream, so it is
 * validated at the route boundary like the swap group's.
 */

import { Stack } from 'expo-router';
import { z } from 'zod';

import { AiRequestScreen } from '@/features/transactions';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  groupId: z.string().min(1).max(256).optional(),
});

function ModalScreen() {
  const params = useRouteParams(ParamsSchema, { where: 'app.aiRequest' });
  if (!params) return null;

  return (
    <>
      <Stack.Screen options={{ title: 'AI request' }} />
      <AiRequestScreen groupId={params.groupId} />
    </>
  );
}

export default ModalScreen;
