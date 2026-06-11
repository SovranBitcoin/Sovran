import React from 'react';
import { StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { alpha, hitSlop, minTouchTarget } from '@/shared/styles/tokens';

/**
 * Canonical header icon button (headerLeft / headerRight). One component so
 * every header action shares the same treatment on BOTH platforms: the
 * "soft circle" — a quiet surface-secondary circle with no border and a
 * slightly dimmed glyph (the iOS-15-sheet close-button idiom, and the flat
 * analog of the liquid-glass circle). ≥44pt touch target everywhere.
 */
interface ScreenHeaderActionProps {
  icon: string;
  onPress: () => void;
  testID?: string;
  color?: string;
  size?: number;
  disabled?: boolean;
  /** Optional accessory rendered over the glyph (e.g. an absolutely
   *  positioned count badge) — positioning is the accessory's concern. */
  accessory?: React.ReactNode;
}

export function ScreenHeaderAction({
  icon,
  onPress,
  testID,
  color,
  size = 24,
  disabled,
  accessory,
}: ScreenHeaderActionProps) {
  const [foreground, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface-secondary',
  ] as const);

  return (
    <Pressable
      onPress={onPress}
      hitSlop={hitSlop.default}
      activeOpacity={0.7}
      style={[
        styles.circle,
        { backgroundColor: surfaceSecondary },
        { opacity: disabled ? 0.4 : 1 },
      ]}
      disabled={disabled}
      testID={testID}>
      <Icon name={icon} size={size} color={color ?? opacity(foreground, alpha.prominent)} />
      {accessory}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: minTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
