import { Stack } from 'expo-router';
import { z } from 'zod';
import { BitChatScreen } from '@/features/bitchat/screens/BitChatScreen';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const GEOHASH = /^[0-9bcdefghjkmnpqrstuvwxyz]{1,12}$/;

const ParamsSchema = z.object({
  geohash: z.string().regex(GEOHASH, 'invalid geohash'),
  tierLabel: z.string().max(64).optional(),
});

export default function BitChatRoute() {
  const params = useRouteParams(ParamsSchema, { where: 'bitchat-flow.geohash' });
  if (!params) return null;

  return (
    <>
      <Stack.Screen
        options={{
          title: params.tierLabel ? `${params.tierLabel} Chat` : `#${params.geohash}`,
        }}
      />
      <BitChatScreen geohash={params.geohash} tierLabel={params.tierLabel} />
    </>
  );
}
