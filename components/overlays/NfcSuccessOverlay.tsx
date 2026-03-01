/**
 * Fullscreen green success overlay with checkmark animation.
 * Used after a successful NFC ecash payment; on animation end the parent navigates to SendTokenScreen.
 * On native, wrapped in FullWindowOverlay (react-native-screens) so it appears above the tab bar
 * and header — same approach as AnimatedImageOverlay.
 * Uses a Reanimated version of line-md:confirm-circle (circle draws, then check) since the
 * original relies on SVG <animate> which doesn't run in RN.
 */

import React, { useMemo, useEffect } from 'react';
import { Platform, StyleSheet } from 'react-native';

import { UntranslatedText } from 'components/ui/Text';
import { FullWindowOverlay } from 'react-native-screens';
import Animated, {
  createAnimatedComponent,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { G, Path } from 'react-native-svg';
import { formatAmount } from 'helper/currency';
import { useThemeColor } from 'hooks/useThemeColor';
const AnimatedPath = createAnimatedComponent(Path);

/** line-md:confirm-circle paths from .monicon; circle then check, stroke-dash animation via Reanimated. */
const CIRCLE_DASH_LENGTH = 64;
const CHECK_DASH_LENGTH = 14;
const CIRCLE_D =
  'M3 12c0 -4.97 4.03 -9 9 -9c4.97 0 9 4.03 9 9c0 4.97 -4.03 9 -9 9c-4.97 0 -9 -4.03 -9 -9Z';
const CHECK_D = 'M8 12l3 3l5 -5';
const CIRCLE_DRAW_MS = 1100;
const CHECK_DRAW_MS = 200;

export function NfcSuccessConfirmCircleIcon({
  color,
  size,
  startDelayMs,
}: {
  color: string;
  size: number;
  startDelayMs: number;
}) {
  const circleDashOffset = useSharedValue(CIRCLE_DASH_LENGTH);
  const checkDashOffset = useSharedValue(CHECK_DASH_LENGTH);

  useEffect(() => {
    circleDashOffset.value = withDelay(startDelayMs, withTiming(0, { duration: CIRCLE_DRAW_MS }));
    checkDashOffset.value = withDelay(
      startDelayMs + CIRCLE_DRAW_MS,
      withTiming(0, { duration: CHECK_DRAW_MS })
    );
  }, [startDelayMs, circleDashOffset, checkDashOffset]);

  const circleAnimatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circleDashOffset.value,
  }));
  const checkAnimatedProps = useAnimatedProps(() => ({
    strokeDashoffset: checkDashOffset.value,
  }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
        <AnimatedPath
          stroke={color}
          strokeDasharray={CIRCLE_DASH_LENGTH}
          d={CIRCLE_D}
          animatedProps={circleAnimatedProps}
        />
        <AnimatedPath
          stroke={color}
          strokeDasharray={CHECK_DASH_LENGTH}
          d={CHECK_D}
          animatedProps={checkAnimatedProps}
        />
      </G>
    </Svg>
  );
}

const OVERLAY_FADE_MS = 280;
const CHECKMARK_DELAY_MS = 180;
const CHECKMARK_SPRING_DURATION_MS = 450;
const HOLD_MS = 1700;
const FADE_OUT_MS = 280;

const CHECK_WHITE = '#ffffff';

const CONFIRM_ICON_SIZE = 96;

interface NfcSuccessOverlayProps {
  onComplete: () => void;
  /** Amount sent in sats; when set, shows "You sent {formatted amount}" (formatted per user prefs). */
  amountSats?: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
function NfcSuccessOverlay({ onComplete, amountSats }: NfcSuccessOverlayProps) {
  const successGreen = useThemeColor('success');
  const bgOpacity = useSharedValue(0);
  const checkScale = useSharedValue(0.4);
  const checkOpacity = useSharedValue(0);

  const amountLabel = useMemo(() => {
    if (amountSats == null || !Number.isFinite(amountSats)) return null;
    return formatAmount({ amount: amountSats, unit: 'sats' }, { useUserPreference: true });
  }, [amountSats]);

  useEffect(() => {
    const fadeOutThenComplete = () => {
      'worklet';
      bgOpacity.value = withTiming(0, { duration: FADE_OUT_MS }, (finished) => {
        'worklet';
        if (finished) runOnJS(onComplete)();
      });
      checkOpacity.value = withTiming(0, { duration: FADE_OUT_MS });
    };

    bgOpacity.value = withTiming(1, { duration: OVERLAY_FADE_MS });
    checkScale.value = withDelay(CHECKMARK_DELAY_MS, withTiming(1, { duration: 320 }));
    checkOpacity.value = withDelay(
      CHECKMARK_DELAY_MS,
      withTiming(1, { duration: CHECKMARK_SPRING_DURATION_MS * 0.4 })
    );

    const fadeOutStartMs = CHECKMARK_DELAY_MS + CHECKMARK_SPRING_DURATION_MS + HOLD_MS;
    const timer = setTimeout(() => {
      fadeOutThenComplete();
    }, fadeOutStartMs);

    return () => clearTimeout(timer);
  }, [onComplete, bgOpacity, checkScale, checkOpacity]);

  const bgStyle = useAnimatedStyle(() => ({
    opacity: bgOpacity.value,
  }));

  const checkStyle = useAnimatedStyle(() => ({
    opacity: checkOpacity.value,
    transform: [{ scale: checkScale.value }],
  }));

  const content = (
    <Animated.View
      style={[styles.overlay, { backgroundColor: successGreen }, bgStyle]}
      pointerEvents="none">
      <Animated.View style={[styles.checkWrap, checkStyle]}>
        <NfcSuccessConfirmCircleIcon
          color={CHECK_WHITE}
          size={CONFIRM_ICON_SIZE}
          startDelayMs={0}
        />
        {amountLabel != null ? (
          <UntranslatedText overpass semibold size={18} style={styles.amountText}>
            You sent {amountLabel}
          </UntranslatedText>
        ) : null}
      </Animated.View>
    </Animated.View>
  );

  if (Platform.OS === 'web') return content;
  return <FullWindowOverlay>{content}</FullWindowOverlay>;
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  checkWrap: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  amountText: {
    color: CHECK_WHITE,
  },
});
