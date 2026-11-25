/**
 * @fileoverview Shared chrome for the notification list surfaces.
 *
 * The notifications tab and its follows detail screen render the same visual
 * language — identical row/typography/empty-state boxes and the same pressed
 * row affordance. This module owns the shared row shell.
 */
import type { ReactNode } from 'react';

import { Pressable } from '@/shared/ui/primitives/Pressable';

/** The tappable notification row shell: full-width padded row, pressed tint. */
export function NotificationRowPressable({
  pressedBackground,
  onPress,
  testID,
  accessibilityLabel,
  children,
}: {
  pressedBackground: string;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      haptics
      activeOpacity={1}
      onPress={onPress}
      className="px-5 py-3.5"
      style={({ pressed }) => (pressed ? { backgroundColor: pressedBackground } : undefined)}>
      {children}
    </Pressable>
  );
}
