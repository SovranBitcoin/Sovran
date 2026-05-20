import React from 'react';
import { StyleSheet } from 'react-native';
import { PressableFeedback } from 'heroui-native';
import opacity from 'hex-color-opacity';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import Icon from 'assets/icons';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import type { CapsuleButtonProps } from './CapsuleButton.types';

const DEFAULT_HEIGHT = 46;

export function CapsuleButtonFlat(props: CapsuleButtonProps): React.ReactElement {
  const [foreground, surfaceSecondary, muted] = useThemeColor([
    'foreground',
    'surface-secondary',
    'muted',
  ] as const);
  const {
    label,
    icon,
    onPress,
    color = foreground,
    height = DEFAULT_HEIGHT,
    testID,
    roundedSide = 'all',
  } = props;

  const cornerStyle = getCornerStyle(roundedSide);

  return (
    <View
      testID={testID}
      style={[
        styles.card,
        cornerStyle,
        {
          minHeight: height,
          backgroundColor: surfaceSecondary,
          borderColor: opacity(muted, 0.3),
        },
      ]}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
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

function getCornerStyle(roundedSide: NonNullable<CapsuleButtonProps['roundedSide']>) {
  switch (roundedSide) {
    case 'left':
      return cornerStyles.leftCorners;
    case 'right':
      return cornerStyles.rightCorners;
    case 'all':
    default:
      return cornerStyles.allCorners;
  }
}

const CORNER_RADIUS = 24;

const cornerStyles = StyleSheet.create({
  allCorners: {
    borderRadius: CORNER_RADIUS,
  },
  leftCorners: {
    borderTopLeftRadius: CORNER_RADIUS,
    borderBottomLeftRadius: CORNER_RADIUS,
  },
  rightCorners: {
    borderTopRightRadius: CORNER_RADIUS,
    borderBottomRightRadius: CORNER_RADIUS,
  },
});
