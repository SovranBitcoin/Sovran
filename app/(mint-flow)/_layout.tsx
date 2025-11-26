/**
 * @fileoverview Mint Flow Modal Layout
 *
 * This layout creates a nested stack navigator inside a modal presentation.
 * The parent root Stack presents this group as a modal (slides up from bottom).
 * Screens within this group push horizontally:
 * - list: Entry point, shows owned mints with balances
 * - add: Discover and add new mints (horizontal push)
 * - info: Mint details and audit info (horizontal push)
 *
 * The first screen shows a close button, subsequent screens show a back button.
 */

import { Stack } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { createFlowLayoutScreenOptions } from '../_layout.modals.config';

export default function MintFlowLayout() {
  const { getPrimaryColor } = useTheme();

  return (
    <Stack screenOptions={createFlowLayoutScreenOptions(getPrimaryColor)}>
      <Stack.Screen name="list" options={{ title: 'Select Mint' }} />
      <Stack.Screen name="add" options={{ title: 'Add Mints' }} />
      <Stack.Screen name="info" options={{ title: 'Mint Details' }} />
      <Stack.Screen name="reviews" options={{ title: 'Reviews' }} />
    </Stack>
  );
}
