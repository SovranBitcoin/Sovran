import React from 'react';
import { StyleSheet } from 'react-native';
import { PressableFeedback } from 'heroui-native';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { Log } from '@/shared/lib/logger';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';

export interface CapsuleButtonProps {
  label: string;
  icon: string;
  systemIcon?: string;
  onPress: () => void;
  color?: string;
  height?: number;
  roundedSide?: 'all' | 'left' | 'right';
  /** Stable accessibility identifier for log-doctor / WDA targeting. */
  testID?: string;
}

interface CapsuleButtonFallbackProps extends CapsuleButtonProps {
  accentColor: string;
  color: string;
  height: number;
}

export function CapsuleButtonFallback({
  label,
  icon,
  onPress,
  color,
  height,
  testID,
  accentColor,
  roundedSide = 'all',
}: CapsuleButtonFallbackProps): React.ReactElement {
  const cornerStyle = getCornerStyle(roundedSide);

  return (
    <Log name="CapsuleButton">
      <View
        testID={testID}
        style={[
          styles.card,
          cornerStyle,
          {
            minHeight: height,
            maxWidth: 140,
            alignSelf: 'center',
          },
        ]}>
        <BlurCardFrame accentColor={accentColor}>
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
        {/* Border drawn on top of the blur so the rounded corners aren't
            eaten by the absolute-filled iOS blur layer underneath. */}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            cornerStyle,
            styles.borderOverlay,
            { borderColor: opacity(accentColor, 0.3) },
          ]}
        />
      </View>
    </Log>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  pressable: {
    width: '100%',
    overflow: 'hidden',
  },
  content: {
    width: '100%',
    paddingHorizontal: 12,
  },
  borderOverlay: {
    borderWidth: 1,
    borderCurve: 'continuous',
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
