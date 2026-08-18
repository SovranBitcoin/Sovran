import { getCornerStyle } from './CapsuleButton.corners';
import React from 'react';
import { StyleSheet } from 'react-native';
import { PressableFeedback } from 'heroui-native';
import { withAlpha } from '@/shared/lib/color';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { controlHeight } from '@/shared/styles/tokens';
import Icon from 'assets/icons';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import type { CapsuleButtonProps } from './CapsuleButton.types';

// controlHeight.cta — matches the liquid variant (48) so all three tiers agree.
const DEFAULT_HEIGHT = controlHeight.cta;

export function CapsuleButtonFlat(props: CapsuleButtonProps): React.ReactElement {
  const [foreground, surfaceSecondary, muted, background] = useThemeColor([
    'foreground',
    'surface-secondary',
    'muted',
    'background',
  ] as const);
  const {
    label,
    icon,
    iconNode,
    onPress,
    color,
    isActive = false,
    filled = false,
    height = DEFAULT_HEIGHT,
    testID,
    roundedSide = 'all',
    fitContent = false,
    iconSize = 16,
    textSize = 14,
    labelNumberOfLines,
    style,
    contentStyle,
    textStyle,
  } = props;

  const cornerStyle = getCornerStyle(roundedSide);
  const widthStyle = fitContent ? null : styles.fullWidth;

  // filled → solid foreground CTA with inverted content; active → tinted fill;
  // default → the neutral surface used by the status pills. An explicit `color`
  // always wins for the content.
  const contentColor = color ?? (filled ? background : foreground);
  const backgroundColor = filled
    ? foreground
    : isActive
      ? withAlpha(foreground, 0.14)
      : surfaceSecondary;
  const borderColor = filled
    ? foreground
    : isActive
      ? withAlpha(foreground, 0.3)
      : withAlpha(muted, 0.3);

  return (
    <View
      testID={testID}
      style={[
        styles.card,
        widthStyle,
        cornerStyle,
        { minHeight: height, backgroundColor, borderColor },
        style,
      ]}>
      <PressableFeedback
        animation={false}
        onPress={onPress}
        style={[styles.pressable, widthStyle, { minHeight: height }]}>
        <HStack
          align="center"
          justify="center"
          gap={8}
          style={[styles.content, widthStyle, { minHeight: height }, contentStyle]}>
          {iconNode ?? (icon ? <Icon name={icon} size={iconSize} color={contentColor} /> : null)}
          <Text
            size={textSize}
            bold
            numberOfLines={labelNumberOfLines}
            style={[{ color: contentColor }, textStyle]}>
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
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
  },
  fullWidth: {
    width: '100%',
  },
  pressable: {
    overflow: 'hidden',
  },
  content: {
    paddingHorizontal: 12,
  },
});
