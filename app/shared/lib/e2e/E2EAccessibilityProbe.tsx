import { useMemo, type ReactElement } from 'react';

import { View } from '@/shared/ui/primitives/View/View';

interface E2EAccessibilityProbeProps {
  testID: string;
  accessibilityLabel: string;
  value?: string;
}

/**
 * Proven 1×1 accessibility envelope for non-visual e2e evidence.
 *
 * Callers own the safety and meaning of the strings. This module owns only the
 * native AX shape that keeps an inert probe visible to both device drivers.
 */
export function E2EAccessibilityProbe({
  testID,
  accessibilityLabel,
  value,
}: E2EAccessibilityProbeProps): ReactElement {
  const accessibilityValue = useMemo(
    () => (value === undefined ? undefined : { text: value }),
    [value]
  );

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={accessibilityValue}
      importantForAccessibility="yes"
      collapsable={false}
      pointerEvents="none"
      className="absolute left-0 top-0 h-px w-px"
    />
  );
}
