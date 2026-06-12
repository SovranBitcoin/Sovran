/**
 * @fileoverview Filter Flow Modal Layout
 *
 * This layout creates a nested stack navigator inside a modal presentation.
 * The parent root Stack presents this group as a modal (slides up from bottom).
 * Used for transaction filtering options.
 */

import { useMemo } from 'react';
import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '../../config/flowLayoutOptions';
import { AndroidSheetRoot } from '@/shared/ui/composed/AndroidSheetRoot';
import { FLOW_SHEET_HEADER_HEIGHT } from '@/shared/ui/composed/FlowSheetHeader';

const FILTERS_OPTIONS = { title: 'Filters' };

export default function FilterFlowLayout() {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const screenOptions = useMemo(
    () => createFlowLayoutScreenOptions({ foreground, background }, { androidSheet: true }),
    [foreground, background]
  );

  return (
    <AndroidSheetRoot headerHeight={FLOW_SHEET_HEADER_HEIGHT}>
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="filters" options={FILTERS_OPTIONS} />
      </Stack>
    </AndroidSheetRoot>
  );
}
