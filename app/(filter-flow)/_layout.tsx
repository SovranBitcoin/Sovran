/**
 * @fileoverview Filter Flow Modal Layout
 *
 * This layout creates a nested stack navigator inside a modal presentation.
 * The parent root Stack presents this group as a modal (slides up from bottom).
 * Used for transaction filtering options.
 */

import { Stack } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';

export default function FilterFlowLayout() {
  const { getPrimaryColor } = useTheme();

  return (
    <Stack screenOptions={createFlowLayoutScreenOptions(getPrimaryColor)}>
      <Stack.Screen name="filters" options={{ title: 'Filters' }} />
    </Stack>
  );
}

