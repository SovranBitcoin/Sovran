import React from 'react';
import { LiquidButtonView } from 'expo-liquid-glass-native';
import { hasAndroidLiquidButtonView } from '@/navigation/nativeTabs';

import Icon from 'assets/icons';
import { Button } from '@/shared/ui/primitives/Button';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

export interface CapsuleButtonProps {
  label: string;
  icon: string;
  systemIcon?: string;
  onPress: () => void;
  color?: string;
  height?: number;
}

const DEFAULT_HEIGHT = 48;
const INVISIBLE_TITLE = '\u2007'.repeat(12);

export function CapsuleButton(props: CapsuleButtonProps): React.ReactElement {
  const foreground = useThemeColor('foreground');
  const { label, icon, onPress, color = foreground, height = DEFAULT_HEIGHT } = props;

  if (hasAndroidLiquidButtonView()) {
    return (
      <View className="w-full" style={{ height }}>
        <LiquidButtonView
          title={INVISIBLE_TITLE}
          enabled
          tint="transparent"
          blurRadius={3}
          onPress={onPress}
          style={{ width: '100%', height, borderRadius: height / 2 }}
        />
        <View
          pointerEvents="none"
          className="absolute inset-0 flex-row items-center justify-center gap-2"
          style={{ elevation: 1 }}>
          <Icon name={icon} size={16} color={color} />
          <Text size={14} style={{ color, fontFamily: 'OxygenBold' }}>
            {label}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <Button
      text={label}
      icon={<Icon name={icon} size={16} color={color} />}
      onPress={onPress}
      variant="secondary"
      blur={{ intensity: 70, tint: 'dark' }}
      haptics
      style={{ margin: 0, marginBottom: 0, width: '100%', minHeight: height }}
    />
  );
}
