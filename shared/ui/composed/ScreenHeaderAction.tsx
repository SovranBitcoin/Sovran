import React from 'react';
import { StyleSheet, View } from 'react-native';
import opacity from 'hex-color-opacity';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { supportsLiquidGlass } from '@/shared/lib/version';
import { HeaderGlassCircle } from '@/shared/ui/composed/HeaderGlassCircle';
import { alpha, headerButtonSize, hitSlop } from '@/shared/styles/tokens';

/**
 * Canonical header icon button (headerLeft / headerRight). One component so
 * every header action shares the mint-selector chrome on BOTH platforms:
 * a surface-secondary circle with a 1px `opacity(muted, 0.3)` border and a
 * slightly dimmed glyph — the flat analog of the liquid-glass circle, sized
 * to match the wallet mint selector (54 on Android; 44 on iOS, whose native
 * nav bars cap custom views). ≥44pt touch target everywhere.
 *
 * On liquid-glass devices (iOS 26+) the button renders inside the
 * app-owned HeaderGlassCircle: the system bar-item capsule is squat and
 * content-width (a pill, shorter than the mint selector), so we suppress
 * it (native-stack hidesSharedBackground patch) and draw the same
 * glassEffect circle the rest of the design system uses, at
 * headerButtonSize — header buttons and the mint selector share one glass
 * geometry.
 */
interface ScreenHeaderActionProps {
  icon: string;
  /** Omit for status-only header chrome that should not behave like a button. */
  onPress?: () => void;
  testID?: string;
  accessibilityLabel?: string;
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
  accessibilityLabel,
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

  const glyph = (
    <Icon name={icon} size={size} color={color ?? opacity(foreground, alpha.prominent)} />
  );

  const circleStyle = React.useMemo(
    () => [
      styles.circle,
      { backgroundColor: surfaceSecondary, borderColor: opacity(muted, 0.3) },
      { opacity: disabled ? 0.4 : 1 },
    ],
    [disabled, muted, surfaceSecondary]
  );

  if (supportsLiquidGlass()) {
    return (
      <HeaderGlassCircle
        onPress={onPress}
        disabled={disabled}
        testID={testID}
        accessibilityLabel={accessibilityLabel}>
        {glyph}
        {accessory}
      </HeaderGlassCircle>
    );
  }

  if (!onPress) {
    return (
      <View
        style={circleStyle}
        testID={testID}
        accessible={!!accessibilityLabel}
        accessibilityRole={accessibilityLabel ? 'image' : undefined}
        accessibilityLabel={accessibilityLabel}>
        {glyph}
        {accessory}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      hitSlop={hitSlop.default}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={circleStyle}
      disabled={disabled}
      testID={testID}>
      {glyph}
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
