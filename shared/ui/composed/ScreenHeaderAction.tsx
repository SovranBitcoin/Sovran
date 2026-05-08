import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

interface ScreenHeaderActionProps {
  icon: string;
  onPress: () => void;
  testID?: string;
  color?: string;
  size?: number;
  disabled?: boolean;
}

export function ScreenHeaderAction({
  icon,
  onPress,
  testID,
  color,
  size = 24,
  disabled,
}: ScreenHeaderActionProps) {
  const [foreground, surfaceSecondary, muted] = useThemeColor([
    'foreground',
    'surface-secondary',
    'muted',
  ] as const);

  return (
    <Pressable
      onPress={onPress}
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
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    padding: 8,
  },
  androidFlat: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
