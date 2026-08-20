/**
 * @fileoverview Theme Flow Modal Layout
 *
 * Nested stack inside a modal presentation, same pattern as send-flow.
 * Parent root Stack presents this group as a modal (slides up from bottom).
 * Screens within push horizontally with close/back header.
 */

import { Stack } from 'expo-router';
import { AndroidSheetFlowStack } from '../../config/flowLayoutOptions';

const PREVIEW_OPTIONS = { title: 'Theme preview' };
const BACKGROUND_OPTIONS = { title: 'Background' };
const GALLERY_OPTIONS = { title: 'Gallery' };

export default function ThemeFlowLayout() {
  return (
    <AndroidSheetFlowStack>
      <Stack.Screen name="preview" options={PREVIEW_OPTIONS} />
      <Stack.Screen name="background" options={BACKGROUND_OPTIONS} />
      <Stack.Screen name="gallery" options={GALLERY_OPTIONS} />
    </AndroidSheetFlowStack>
  );
}
