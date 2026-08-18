import { getCornerStyle } from './CapsuleButton.corners';
import React, { useMemo, useRef } from 'react';
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

  // Synthesized taps (VoiceOver activation, HID automation like serve-sim)
  // reach the JS touch responder but the RNGH Tap recognizer never fires for
  // them next to the interactive glass. Fall back to firing the press from
  // the plain responder when RNGH stays silent for a beat after touch-up;
  // real finger taps recognize instantly and suppress the fallback. A >10pt
  // drag cancels it, matching Tap's own maxDistance.
  const rnghFired = useRef(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  const tap = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .onEnd((_event, success) => {
          if (success) {
            rnghFired.current = true;
            void guardedPress();
          }
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
        onTouchStart={(e) => {
          rnghFired.current = false;
          moved.current = false;
          touchStart.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
        }}
        onTouchMove={(e) => {
          const start = touchStart.current;
          if (!start) return;
          if (
            Math.abs(e.nativeEvent.pageX - start.x) > 10 ||
            Math.abs(e.nativeEvent.pageY - start.y) > 10
          ) {
            moved.current = true;
          }
        }}
        onTouchEnd={() => {
          if (moved.current) return;
          setTimeout(() => {
            if (!rnghFired.current) void guardedPress();
          }, 180);
        }}
        glassEffectStyle="regular"
        isInteractive
        tintColor={tintColor}
        style={[styles.glass, widthStyle, cornerStyle, { minHeight: height }, style]}>
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
