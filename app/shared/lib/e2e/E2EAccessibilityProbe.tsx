import { useMemo, type ReactElement } from 'react';

import { View } from '@/shared/ui/primitives/View/View';
import { SHOW_LOGS } from '@/shared/lib/loggerCore';

/**
 * Probes exist for device drivers: dev clients and bundled e2e builds
 * (`EXPO_PUBLIC_E2E_LOGS=1`). A store build mounts none, so its accessibility
 * tree carries no 1×1 evidence views.
 */
export const E2E_PROBES_ENABLED = SHOW_LOGS;

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
}: E2EAccessibilityProbeProps): ReactElement | null {
  const accessibilityValue = useMemo(
    () => (value === undefined ? undefined : { text: value }),
    [value]
  );
  if (!E2E_PROBES_ENABLED) return null;

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
