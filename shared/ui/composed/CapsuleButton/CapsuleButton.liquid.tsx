import React from 'react';
import { StyleSheet } from 'react-native';
import { PressableFeedback } from 'heroui-native';

import { GlassView } from 'expo-glass-effect';

import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { controlHeight } from '@/shared/styles/tokens';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import type { CapsuleButtonProps } from './CapsuleButton.types';

// controlHeight.cta — matches the blur/flat variants (48) so all tiers agree.
const DEFAULT_HEIGHT = controlHeight.cta;

// Render Liquid Glass via expo-glass-effect's GlassView (a UIVisualEffectView-
// backed React Native view) rather than an @expo/ui SwiftUI `Host`. Host views
// are rendered by a UIHostingController that does NOT follow an RN ScrollView's
// content transform, so they visually pin to the top while scrolling
// (expo/expo#46278). GlassView is a normal RN view and scrolls correctly.
export function CapsuleButtonLiquid(props: CapsuleButtonProps): React.ReactElement {
  const [foreground] = useThemeColor(['foreground'] as const);
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
    <GlassView
      testID={testID}
      glassEffectStyle="regular"
      isInteractive
      style={[styles.glass, cornerStyle, { minHeight: height }]}>
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
    </GlassView>
  );
}

const styles = StyleSheet.create({
  glass: {
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
