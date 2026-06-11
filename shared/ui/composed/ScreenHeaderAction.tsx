import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { hitSlop, minTouchTarget } from '@/shared/styles/tokens';

/**
 * Canonical header icon button (headerLeft / headerRight). One component so
 * every header action shares the same ≥44pt touch target and the same
 * platform treatment: iOS renders the bare glyph (system headers carry the
 * affordance), Android gets a filled circular chip since its headers have no
 * native button chrome.
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
      style={[
        styles.base,
        Platform.OS === 'android' ? styles.androidFlat : null,
        Platform.OS === 'android'
          ? { backgroundColor: surfaceSecondary, borderColor: opacity(muted, 0.3) }
          : null,
        { opacity: disabled ? 0.4 : 1 },
      ]}
      disabled={disabled}
      testID={testID}>
      <Icon name={icon} size={size} color={color ?? foreground} />
      {accessory}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  androidFlat: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: minTouchTarget / 2,
    borderWidth: 1,
  },
});
