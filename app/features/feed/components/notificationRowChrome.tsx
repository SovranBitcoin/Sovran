/**
 * @fileoverview Shared chrome for the notification list surfaces.
 *
 * The notifications tab and its follows detail screen render the same visual
 * language — identical row/typography/empty-state boxes and the same pressed
 * row affordance. This module owns that shared subset once; each screen keeps
 * only its genuinely screen-specific styles (separator inset, group rows,
 * filter bar).
 */
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { Pressable } from '@/shared/ui/primitives/Pressable';

export const notificationListStyles = StyleSheet.create({
  root: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 8,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  row: {
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  titleLine: {
    width: '100%',
  },
  titleText: {
    flex: 1,
    minWidth: 0,
  },
  timestampText: {
    flexShrink: 0,
    paddingTop: 2,
  },
  emptyState: {
    paddingHorizontal: 28,
  },
  loader: {
    alignSelf: 'center',
  },
  footerSpinner: {
    alignSelf: 'center',
    marginVertical: 18,
  },
});

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
      style={({ pressed }) => [
        notificationListStyles.row,
        pressed && { backgroundColor: pressedBackground },
      ]}>
      {children}
    </Pressable>
  );
}
