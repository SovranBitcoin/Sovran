import React from 'react';
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
  const foreground = useThemeColor('foreground');
  return (
    <Pressable
      onPress={onPress}
      style={{ padding: 8, opacity: disabled ? 0.4 : 1 }}
      disabled={disabled}
      testID={testID}>
      <Icon name={icon} size={size} color={color ?? foreground} />
    </Pressable>
  );
}
