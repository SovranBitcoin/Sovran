import { Stack } from 'expo-router';
import { INVARIANT_BLACK } from '@/shared/lib/brandColors';
import { getImmersiveFlowScreenOptions } from '@/config/flowLayoutOptions';

export default function StoriesFlowLayout() {
  return (
    <Stack screenOptions={getImmersiveFlowScreenOptions(INVARIANT_BLACK)}>
      <Stack.Screen name="stories" />
    </Stack>
  );
}
