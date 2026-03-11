import React from 'react';
import { StyleSheet } from 'react-native';
import { PressableFeedback } from 'heroui-native';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { supportsLiquidGlass } from '@/shared/lib/version';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { CapsuleButtonLiquid } from './CapsuleButton.liquid';

export interface CapsuleButtonProps {
  label: string;
  icon: string;
  systemIcon?: string;
  onPress: () => void;
  color?: string;
  height?: number;
}

const DEFAULT_HEIGHT = 46;

export function CapsuleButton(props: CapsuleButtonProps): React.ReactElement {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  const { label, icon, onPress, color = foreground, height = DEFAULT_HEIGHT } = props;

  if (supportsLiquidGlass()) {
    return <CapsuleButtonLiquid {...props} color={color} />;
  }

  return (
    <View
      style={[
        styles.card,
        {
          borderColor: opacity(muted, 0.3),
          minHeight: height,
          maxWidth: 140,
          alignSelf: 'center',
        },
      ]}>
      <BlurCardFrame accentColor={muted}>
        <PressableFeedback
          animation={false}
          onPress={onPress}
          style={[styles.pressable, { minHeight: height }]}>
          <HStack
            align="center"
            justify="center"
            spacing={8}
            style={[styles.content, { minHeight: height }]}>
            <Icon name={icon} size={16} color={color} />
            <Text size={14} bold style={{ color }}>
              {label}
            </Text>
          </HStack>
          <PressableFeedback.Ripple />
        </PressableFeedback>
      </BlurCardFrame>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderRadius: 24,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
  },
  pressable: {
    width: '100%',
    overflow: 'hidden',
  },
  content: {
    width: '100%',
    paddingHorizontal: 12,
  },
});
