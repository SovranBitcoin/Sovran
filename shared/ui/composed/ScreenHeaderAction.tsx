import React from 'react';
import { TouchableOpacity } from 'react-native';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

export interface ScreenHeaderActionProps {
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
  const foreground = useThemeColor('foreground');
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{ padding: 8, opacity: disabled ? 0.4 : 1 }}
      disabled={disabled}
      testID={testID}>
      <Icon name={icon} size={size} color={color ?? foreground} />
    </TouchableOpacity>
  );
}
