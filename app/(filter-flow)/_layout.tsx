/**
 * @fileoverview Filter Flow Modal Layout
 *
 * This layout creates a nested stack navigator inside a modal presentation.
 * The parent root Stack presents this group as a modal (slides up from bottom).
 * Used for transaction filtering options.
 */

import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';

export default function FilterFlowLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);

  return (
    <Stack screenOptions={createFlowLayoutScreenOptions({ foreground, background })}>
      <Stack.Screen name="filters" options={{ title: 'Filters' }} />
    </Stack>
  );
}
