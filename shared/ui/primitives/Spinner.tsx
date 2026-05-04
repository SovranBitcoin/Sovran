import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';

export function Spinner({
  size = 8,
  style,
  color,
}: {
  size?: number;
  style?: StyleProp<ViewStyle>;
  color?: string;
}) {
  const foreground = useThemeColor('foreground');
  return (
    <Icon
      name="ant-design:loading-outlined"
      size={size}
      color={color || opacity(foreground, 0.9)}
      style={style}
      spin={{
        delay: 0,
        duration: 1000,
        outputRange: ['0deg', '360deg'],
        easing: 'linear',
      }}
    />
  );
}
