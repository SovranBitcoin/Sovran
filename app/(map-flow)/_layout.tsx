/**
 * @fileoverview Map Flow Modal Layout
 *
 * This layout creates a nested stack navigator inside a modal presentation.
 * The parent root Stack presents this group as a modal (slides up from bottom).
 * Screens within this group push horizontally:
 * - index: Entry point, shows the Bitcoin merchant map
 * - detail: Merchant details (horizontal push)
 */

import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';

const INDEX_OPTIONS = { title: 'Bitcoin map' };
const DETAIL_OPTIONS = { title: 'Merchant details' };

export default function MapFlowLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const screenOptions = useMemo(
    () => createFlowLayoutScreenOptions({ foreground, background }),
    [foreground, background]
  );

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={INDEX_OPTIONS} />
      <Stack.Screen name="detail" options={DETAIL_OPTIONS} />
    </Stack>
  );
}
