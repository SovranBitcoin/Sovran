import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import opacity from 'hex-color-opacity';

import { GlassView } from 'expo-glass-effect';

import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
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
//
// `isInteractive` restores the native press lensing the camera toolbar buttons
// have. The tap is driven by a gesture-handler `Tap` rather than heroui's
// `PressableFeedback`: the interactive glass installs its own UIKit gesture
// recognizer, and a JS touch responder loses arbitration to it intermittently
// (the iOS-26 tap-swallow that forced `isInteractive` off in 17b70500). A
// gesture-handler recognizer arbitrates natively alongside the glass, so the tap
// fires reliably — critical here since these are the Send/Receive entry points.
export function CapsuleButtonLiquid(props: CapsuleButtonProps): React.ReactElement {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const {
    label,
    icon,
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

  // filled → a heavily foreground-tinted "prominent" glass (the inverted CTA),
  // with content flipped to `background`; active → a subtle foreground tint;
  // default → untinted clear glass, matching the status pills. An explicit
  // `color` always wins for the content.
  const contentColor = color ?? (filled ? background : foreground);
  const tintColor = filled ? foreground : isActive ? opacity(foreground, 0.18) : undefined;

  // Preserve the single-flight guard PressableFeedback's onPress used to provide
  // so a rapid double-tap can't fire Send/Receive twice.
  const guardedPress = useSingleFlight(async () => {
    const result = onPress() as unknown;
    if (result instanceof Promise) await result;
  });

  const tap = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .onEnd((_event, success) => {
          if (success) void guardedPress();
        }),
    [guardedPress]
  );

  return (
    <GestureDetector gesture={tap}>
      <GlassView
        testID={testID}
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        glassEffectStyle="regular"
        isInteractive
        tintColor={tintColor}
        style={[styles.glass, widthStyle, cornerStyle, { minHeight: height }, style]}>
        <HStack
          align="center"
          justify="center"
          spacing={8}
          style={[styles.content, widthStyle, { minHeight: height }, contentStyle]}>
          <Icon name={icon} size={iconSize} color={contentColor} />
          <Text
            size={textSize}
            bold
            numberOfLines={labelNumberOfLines}
            style={[{ color: contentColor }, textStyle]}>
            {label}
          </Text>
        </HStack>
      </GlassView>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  glass: {
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  fullWidth: {
    width: '100%',
  },
  content: {
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
