/**
 * @fileoverview Map Flow Modal Layout
 *
 * This layout creates a nested stack navigator inside a modal presentation.
 * The parent root Stack presents this group as a modal (slides up from bottom).
 * Screens within this group push horizontally:
 * - index: Entry point, shows the Bitcoin merchant map
 * - detail: Merchant details (horizontal push)
 */

import { Stack } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';

export default function MapFlowLayout() {
  const { getPrimaryColor } = useTheme();

  return (
    <Stack screenOptions={createFlowLayoutScreenOptions(getPrimaryColor)}>
      <Stack.Screen name="index" options={{ title: 'Bitcoin Map' }} />
      <Stack.Screen name="detail" options={{ title: 'Merchant Details' }} />
    </Stack>
  );
}
