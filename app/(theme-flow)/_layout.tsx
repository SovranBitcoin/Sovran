/**
 * @fileoverview Theme Flow Modal Layout
 *
 * Nested stack inside a modal presentation, same pattern as send-flow.
 * Parent root Stack presents this group as a modal (slides up from bottom).
 * Screens within push horizontally with close/back header.
 */

import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';

const PREVIEW_OPTIONS = { title: 'Theme Preview' };
const BACKGROUND_OPTIONS = { title: 'Background' };
const GALLERY_OPTIONS = { title: 'Gallery' };

export default function ThemeFlowLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const screenOptions = useMemo(
    () => createFlowLayoutScreenOptions({ foreground, background }),
    [foreground, background]
  );

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="preview" options={PREVIEW_OPTIONS} />
      <Stack.Screen name="background" options={BACKGROUND_OPTIONS} />
      <Stack.Screen name="gallery" options={GALLERY_OPTIONS} />
    </Stack>
  );
}
