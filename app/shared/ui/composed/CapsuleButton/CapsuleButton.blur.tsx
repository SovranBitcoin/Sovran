import { getCornerStyle } from './CapsuleButton.corners';
import React from 'react';
import { StyleSheet } from 'react-native';
import { PressableFeedback } from 'heroui-native';
import { withAlpha } from '@/shared/lib/color';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import { View } from '@/shared/ui/primitives/View/View';
import { CapsuleButtonContent, DEFAULT_HEIGHT, capsuleWidthStyle } from './CapsuleButton.content';
import { CapsuleButtonFlat } from './CapsuleButton.flat';
import type { CapsuleButtonProps } from './CapsuleButton.types';

export function CapsuleButtonBlur(props: CapsuleButtonProps): React.ReactElement {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);

  // A filled CTA is opaque, so the blur would be hidden — render the same solid
  // capsule the flat tier does. (After the hook call to satisfy rules-of-hooks.)
  if (props.filled) return <CapsuleButtonFlat {...props} />;

  const {
    onPress,
    label,
    accessibilityLabel,
    color = foreground,
    isActive = false,
    height = DEFAULT_HEIGHT,
    testID,
    roundedSide = 'all',
    fitContent = false,
    style,
  } = props;
  const accentColor = muted;
  // Active → a foreground tint over the blur + a foreground border (the
  // selected/toggle look); inactive → the neutral muted treatment used by the
  // status pills.
  const borderColor = isActive ? foreground : accentColor;
  const cornerStyle = getCornerStyle(roundedSide);
  const widthStyle = capsuleWidthStyle(fitContent);

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
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? label}
          style={[styles.pressable, widthStyle, { minHeight: height }]}>
          <CapsuleButtonContent
            {...props}
            contentColor={color}
            height={height}
            widthStyle={widthStyle}
          />
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
  pressable: {
    overflow: 'hidden',
  },
  borderOverlay: {
    borderWidth: 1,
    borderCurve: 'continuous',
  },
});
