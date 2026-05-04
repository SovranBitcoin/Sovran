import React from 'react';
import { LiquidButtonView } from 'expo-liquid-glass-native';
import { hasAndroidLiquidButtonView } from '@/navigation/nativeTabs';

import Icon from 'assets/icons';
import { Log } from '@/shared/lib/logger';
import { Button } from '@/shared/ui/primitives/Button';
import { Pressable } from '@/shared/ui/primitives/Pressable';
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
  /** Stable accessibility identifier for log-doctor / WDA targeting. */
  testID?: string;
}

const DEFAULT_HEIGHT = 46;

export function CapsuleButton(props: CapsuleButtonProps): React.ReactElement {
  const foreground = useThemeColor('foreground');
  const { label, icon, onPress, color = foreground, height = DEFAULT_HEIGHT, testID } = props;

  if (hasAndroidLiquidButtonView()) {
    // LiquidButtonView is a glass overlay only - its native module accepts no
    // onPress/title/enabled props, so the outer Pressable owns all tap handling.
    return (
      <Log name="CapsuleButton">
        <Pressable
          testID={testID}
          onPress={onPress}
          className="w-full"
          style={{ height, borderRadius: height / 2, overflow: 'hidden' }}>
          <LiquidButtonView
            tint="transparent"
            blurRadius={3}
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
        </Pressable>
      </Log>
    );
  }

  return (
    <Log name="CapsuleButton">
      <Button
        testID={testID}
        text={label}
        icon={<Icon name={icon} size={16} color={color} />}
        onPress={onPress}
        variant="secondary"
        blur={{ intensity: 70, tint: 'dark' }}
        haptics
        style={{
          margin: 0,
          marginBottom: 0,
          width: '100%',
          minHeight: height,
          maxWidth: 140,
          alignSelf: 'center',
          borderRadius: 24,
        }}
      />
    </Log>
  );
}
