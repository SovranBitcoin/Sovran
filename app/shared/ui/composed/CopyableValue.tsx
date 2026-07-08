/**
 * @fileoverview Tappable detail value that copies its full value to the clipboard.
 *
 * Drop-in `value` for a `DetailsList` / `DetailsSection` row: shows a
 * (usually truncated) display string plus a copy icon, and on press copies the
 * full `value` with the standard haptic + toast pattern (mirrors PaymentInfo).
 */

import React, { useCallback } from 'react';
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
import opacity from 'hex-color-opacity';

interface CopyableValueProps {
  /** Full value copied to the clipboard. */
  value: string;
  /** Truncated/display string shown in the row (defaults to `value`). */
  display?: string;
  /** Copy popup + AX target (drives the toast message). */
  copyTarget: CopyTarget;
}

export function CopyableValue({ value, display, copyTarget }: CopyableValueProps) {
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
      accessibilityRole="button"
      accessibilityLabel={`Copy ${copyTarget}`}>
      <HStack align="center">
        <Text weight="bold" size={16} color={foreground} style={{ textAlign: 'right' }}>
          {display ?? value}
        </Text>
        <Spacer size={6} />
        <Icon name="lets-icons:copy" color={opacity(foreground, 0.6)} size={16} />
      </HStack>
    </Pressable>
  );
}
