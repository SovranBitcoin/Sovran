/**
 * @fileoverview Tappable detail value that copies its full value to the clipboard.
 *
 * Drop-in `value` for a `DetailsList` / `DetailsSection` row: shows the value
 * on one line, eliding its middle to fit, plus a copy icon, and on press copies
 * the full `value` with the standard haptic + toast pattern (mirrors PaymentInfo).
 */

import { useCallback } from 'react';
import * as Clipboard from 'expo-clipboard';
import Icon from 'assets/icons';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { copyPopup, type CopyTarget } from '@/shared/lib/popup';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { paymentLog } from '@/shared/lib/logger';
import { withAlpha } from '@/shared/lib/color';

interface CopyableValueProps {
  /** Full value copied to the clipboard. */
  value: string;
  /** Display string shown in the row when it differs from `value` (a label,
   *  not a sliced copy — the text view already elides long values). */
  display?: string;
  /** Copy popup + AX target (drives the toast message). */
  copyTarget: CopyTarget;
  /** e2e selector; defaults to `copy-value-${copyTarget}`. Pass an
   *  entity-scoped id when one screen shows two values of the same target. */
  testID?: string;
}

export function CopyableValue({ value, display, copyTarget, testID }: CopyableValueProps) {
  const foreground = useThemeColor('foreground');

  const handleCopyPress = useCallback(async () => {
    paymentLog.info('ui.copyable_value.copy', { copyTarget, valueLength: value.length });
    await EnhancedHaptics.copyHaptic();
    await Clipboard.setStringAsync(value);
    copyPopup(copyTarget);
  }, [value, copyTarget]);

  return (
    <Pressable
      onPress={handleCopyPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      testID={testID ?? `copy-value-${copyTarget}`}
      accessibilityRole="button"
      accessibilityLabel={`Copy ${copyTarget}`}
      className="shrink">
      <HStack align="center" className="shrink">
        <Text
          weight="bold"
          size={16}
          color={foreground}
          numberOfLines={1}
          ellipsizeMode="middle"
          className="shrink"
          style={{ textAlign: 'right' }}>
          {display ?? value}
        </Text>
        <Spacer size={6} />
        <Icon name="lets-icons:copy" color={withAlpha(foreground, 0.6)} size={16} />
      </HStack>
    </Pressable>
  );
}
