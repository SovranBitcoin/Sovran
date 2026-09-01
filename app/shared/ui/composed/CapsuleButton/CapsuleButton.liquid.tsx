import { getCornerStyle } from './CapsuleButton.corners';
import React, { useCallback, useMemo, useRef } from 'react';
import { StyleSheet, type GestureResponderEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { withAlpha } from '@/shared/lib/color';

import { GlassView } from 'expo-glass-effect';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { CapsuleButtonContent, DEFAULT_HEIGHT, capsuleWidthStyle } from './CapsuleButton.content';
import type { CapsuleButtonProps } from './CapsuleButton.types';

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
/** Drag distance that cancels the fallback, matching RNGH Tap's own maxDistance. */
const TAP_FALLBACK_MAX_DRIFT_PX = 10;
/** How long to wait for RNGH to claim the tap before the responder fires it. */
const TAP_FALLBACK_DELAY_MS = 180;

/**
 * RNGH tap with a plain-responder fallback for synthesized taps.
 *
 * Synthesized taps (VoiceOver activation, HID automation like serve-sim) reach
 * the JS touch responder but the RNGH Tap recognizer never fires for them next
 * to interactive glass. So the responder fires the press itself when RNGH has
 * stayed silent for a beat after touch-up; real finger taps recognize instantly
 * and suppress the fallback.
 *
 * The three tracking refs live in here rather than in the button: the gesture's
 * `onEnd` closes over one of them and is handed to `Gesture.Tap()` during
 * render, which React Compiler reads as a render-time ref access — enough to
 * skip the whole button.
 */
function useGlassTapFallback(onPress: () => void) {
  const rnghFired = useRef(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  const gesture = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .onEnd((_event, success) => {
          if (success) {
            rnghFired.current = true;
            onPress();
          }
        }),
    [onPress]
  );

  const onTouchStart = useCallback((e: GestureResponderEvent) => {
    rnghFired.current = false;
    moved.current = false;
    touchStart.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
  }, []);

  const onTouchMove = useCallback((e: GestureResponderEvent) => {
    const start = touchStart.current;
    if (!start) return;
    if (
      Math.abs(e.nativeEvent.pageX - start.x) > TAP_FALLBACK_MAX_DRIFT_PX ||
      Math.abs(e.nativeEvent.pageY - start.y) > TAP_FALLBACK_MAX_DRIFT_PX
    ) {
      moved.current = true;
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    if (moved.current) return;
    setTimeout(() => {
      if (!rnghFired.current) onPress();
    }, TAP_FALLBACK_DELAY_MS);
  }, [onPress]);

  return { gesture, onTouchStart, onTouchMove, onTouchEnd };
}

export function CapsuleButtonLiquid(props: CapsuleButtonProps): React.ReactElement {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const {
    label,
    accessibilityLabel,
    onPress,
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

  // filled → a heavily foreground-tinted "prominent" glass (the inverted CTA),
  // with content flipped to `background`; active → a subtle foreground tint;
  // default → untinted clear glass, matching the status pills. An explicit
  // `color` always wins for the content.
  const contentColor = color ?? (filled ? background : foreground);
  const tintColor = filled ? foreground : isActive ? withAlpha(foreground, 0.18) : undefined;

  // Preserve the single-flight guard PressableFeedback's onPress used to provide
  // so a rapid double-tap can't fire Send/Receive twice.
  const guardedPress = useSingleFlight(async () => {
    const result = onPress() as unknown;
    if (result instanceof Promise) await result;
  });

  const { gesture, onTouchStart, onTouchMove, onTouchEnd } = useGlassTapFallback(guardedPress);

  return (
    <GestureDetector gesture={gesture}>
      <GlassView
        testID={testID}
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        glassEffectStyle="regular"
        isInteractive
        tintColor={tintColor}
        style={[styles.glass, widthStyle, cornerStyle, { minHeight: height }, style]}>
        <CapsuleButtonContent
          {...props}
          contentColor={contentColor}
          height={height}
          widthStyle={widthStyle}
        />
      </GlassView>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  glass: {
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
});
