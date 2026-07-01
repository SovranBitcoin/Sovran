import { Stack } from 'expo-router';
import { getImmersiveFlowScreenOptions } from '@/config/flowLayoutOptions';

export default function StoriesFlowLayout() {
  return (
    <Stack screenOptions={getImmersiveFlowScreenOptions('#000')}>
      <Stack.Screen name="stories" />
    </Stack>
  );
}
