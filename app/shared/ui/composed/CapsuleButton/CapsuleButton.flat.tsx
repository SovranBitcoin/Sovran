import { getCornerStyle } from './CapsuleButton.corners';
import React from 'react';
import { StyleSheet } from 'react-native';
import { PressableFeedback } from 'heroui-native';
import { withAlpha } from '@/shared/lib/color';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { View } from '@/shared/ui/primitives/View/View';
import { CapsuleButtonContent, DEFAULT_HEIGHT, capsuleWidthStyle } from './CapsuleButton.content';
import type { CapsuleButtonProps } from './CapsuleButton.types';

export function CapsuleButtonFlat(props: CapsuleButtonProps): React.ReactElement {
  const [foreground, surfaceSecondary, muted, background] = useThemeColor([
    'foreground',
    'surface-secondary',
    'muted',
    'background',
  ] as const);
  const {
    onPress,
    label,
    accessibilityLabel,
    color,
    isActive = false,
    filled = false,
    height = DEFAULT_HEIGHT,
    testID,
    roundedSide = 'all',
    fitContent = false,
    style,
  } = props;

  const cornerStyle = getCornerStyle(roundedSide);
  const widthStyle = capsuleWidthStyle(fitContent);

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
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        style={[styles.pressable, widthStyle, { minHeight: height }]}>
        <CapsuleButtonContent
          {...props}
          contentColor={contentColor}
          height={height}
          widthStyle={widthStyle}
        />
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
  pressable: {
    overflow: 'hidden',
  },
});
