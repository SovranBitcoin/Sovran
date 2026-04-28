/**
 * @fileoverview Theme Flow Modal Layout
 *
 * Nested stack inside a modal presentation, same pattern as send-flow.
 * Parent root Stack presents this group as a modal (slides up from bottom).
 * Screens within push horizontally with close/back header.
 */

import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';

export default function ThemeFlowLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);

  return (
    <Stack screenOptions={createFlowLayoutScreenOptions({ foreground, background })}>
      <Stack.Screen name="preview" options={{ title: 'Theme Preview' }} />
      <Stack.Screen name="background" options={{ title: 'Background' }} />
      <Stack.Screen name="gallery" options={{ title: 'Gallery' }} />
    </Stack>
  );
}
