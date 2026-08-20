/**
 * @fileoverview Filter Flow Modal Layout
 *
 * This layout creates a nested stack navigator inside a modal presentation.
 * The parent root Stack presents this group as a modal (slides up from bottom).
 * Used for transaction filtering options.
 */

import { Stack } from 'expo-router';
import { AndroidSheetFlowStack } from '../../config/flowLayoutOptions';

const FILTERS_OPTIONS = { title: 'Filters' };

export default function FilterFlowLayout() {
  return (
    <AndroidSheetFlowStack>
      <Stack.Screen name="filters" options={FILTERS_OPTIONS} />
    </AndroidSheetFlowStack>
  );
}
