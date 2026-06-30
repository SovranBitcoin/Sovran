import { Stack } from 'expo-router';

import { ThreadScreen } from '@/features/feed';

export default function ThreadScreenRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Thread' }} />
      <ThreadScreen />
    </>
  );
}
