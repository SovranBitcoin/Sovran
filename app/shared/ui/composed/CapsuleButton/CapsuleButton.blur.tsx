import { getCornerStyle } from './CapsuleButton.corners';
import React from 'react';
import { StyleSheet } from 'react-native';
import { PressableFeedback } from 'heroui-native';
import { withAlpha } from '@/shared/lib/color';

import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { controlHeight } from '@/shared/styles/tokens';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { CapsuleButtonFlat } from './CapsuleButton.flat';
import type { CapsuleButtonProps } from './CapsuleButton.types';

// controlHeight.cta — matches the liquid variant (48) so all three tiers agree.
const DEFAULT_HEIGHT = controlHeight.cta;

export function CapsuleButtonBlur(props: CapsuleButtonProps): React.ReactElement {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);

  // A filled CTA is opaque, so the blur would be hidden — render the same solid
  // capsule the flat tier does. (After the hook call to satisfy rules-of-hooks.)
  if (props.filled) return <CapsuleButtonFlat {...props} />;

  const {
    label,
    icon,
    iconNode,
    onPress,
    color = foreground,
    isActive = false,
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
  const accentColor = muted;
  // Active → a foreground tint over the blur + a foreground border (the
  // selected/toggle look); inactive → the neutral muted treatment used by the
  // status pills.
  const borderColor = isActive ? foreground : accentColor;
  const cornerStyle = getCornerStyle(roundedSide);
  const widthStyle = fitContent ? null : styles.fullWidth;

  return (
    <View
      testID={testID}
      style={[
        styles.card,
        widthStyle,
        cornerStyle,
        {
          minHeight: height,
        },
        style,
      ]}>
      <BlurCardFrame accentColor={accentColor}>
        {isActive ? (
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(foreground, 0.12) }]}
          />
        ) : null}
        <PressableFeedback
          animation={false}
          onPress={onPress}
          style={[styles.pressable, widthStyle, { minHeight: height }]}>
          <HStack
            align="center"
            justify="center"
            gap={8}
            style={[styles.content, widthStyle, { minHeight: height }, contentStyle]}>
            {iconNode ?? (icon ? <Icon name={icon} size={iconSize} color={color} /> : null)}
            <Text
              size={textSize}
              bold
              numberOfLines={labelNumberOfLines}
              style={[{ color }, textStyle]}>
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
          StyleSheet.absoluteFill,
          cornerStyle,
          styles.borderOverlay,
          { borderColor: withAlpha(borderColor, 0.3) },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderCurve: 'continuous',
    overflow: 'hidden',
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
  borderOverlay: {
    borderWidth: 1,
    borderCurve: 'continuous',
  },
});
