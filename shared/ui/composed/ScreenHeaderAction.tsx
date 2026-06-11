import React from 'react';
import { StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { alpha, headerButtonSize, hitSlop } from '@/shared/styles/tokens';

/**
 * Canonical header icon button (headerLeft / headerRight). One component so
 * every header action shares the mint-selector chrome on BOTH platforms:
 * a surface-secondary circle with a 1px `opacity(muted, 0.3)` border and a
 * slightly dimmed glyph — the flat analog of the liquid-glass circle, sized
 * to match the wallet mint selector (54 on Android; 44 on iOS, whose native
 * nav bars cap custom views). ≥44pt touch target everywhere.
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
  const [foreground, surfaceSecondary, muted] = useThemeColor([
    'foreground',
    'surface-secondary',
    'muted',
  ] as const);

  return (
    <Pressable
      onPress={onPress}
      hitSlop={hitSlop.default}
      activeOpacity={0.7}
      style={[
        styles.circle,
        { backgroundColor: surfaceSecondary, borderColor: opacity(muted, 0.3) },
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
    width: headerButtonSize,
    height: headerButtonSize,
    borderRadius: headerButtonSize / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
