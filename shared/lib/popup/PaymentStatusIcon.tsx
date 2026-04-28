import React, { useEffect } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  cancelAnimation,
  createAnimatedComponent,
  Easing,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

const CIRCLE_PATH =
  'M3 12c0 -4.97 4.03 -9 9 -9c4.97 0 9 4.03 9 9c0 4.97 -4.03 9 -9 9c-4.97 0 -9 -4.03 -9 -9Z';
const CHECKMARK_PATH = 'M8 12l3 3l5 -5';
const CROSS_PATH = 'M12 12l4 4M12 12l-4 -4M12 12l-4 4M12 12l4 -4';
const CIRCLE_LENGTH = 60;
const CHECKMARK_LENGTH = 14;
const CROSS_LENGTH = 23;
const PENDING_OFFSET = 45;

const AnimatedPath = createAnimatedComponent(Path);

type Status = 'pending' | 'delivered' | 'confirmed' | 'failed';

export function PaymentStatusIcon({
  size,
  status,
  baseColor,
}: {
  size: number;
  status: Status;
  /** Override the pre-confirmation/failure stroke color. Defaults to the
   * theme `foreground`. Toasts use a fixed `#000000` since they render on a
   * theme-invariant white background. */
  baseColor?: string;
}): React.ReactElement {
  const [themeForeground, success, danger] = useThemeColor([
    'foreground',
    'success',
    'danger',
  ] as const);
  const foreground = baseColor ?? themeForeground;
  // Initialise shared values from the *initial* status so a fresh mount
  // with a terminal status renders the end-state immediately. Otherwise
  // the useEffect below replays the draw-from-scratch animation every
  // time a parent (e.g. SettingsRecoveryScreen swapping recovering →
  // complete) remounts the row with `status='confirmed'`. Mounts that
  // start at pending still get the proper transition animation because
  // those start at the PENDING_OFFSET / *_LENGTH defaults below.
  const isInitialConfirmed = status === 'confirmed';
  const isInitialFailed = status === 'failed';
  const isInitialTerminal = isInitialConfirmed || isInitialFailed;
  const rotation = useSharedValue(0);
  const circleOffset = useSharedValue(isInitialTerminal ? 0 : PENDING_OFFSET);
  const checkmarkOffset = useSharedValue(isInitialConfirmed ? 0 : CHECKMARK_LENGTH);
  const crossOffset = useSharedValue(isInitialFailed ? 0 : CROSS_LENGTH);
  const colorProgress = useSharedValue(isInitialTerminal ? 1 : 0);

  useEffect(() => {
    if (status === 'pending' || status === 'delivered') {
      circleOffset.set(PENDING_OFFSET);
      checkmarkOffset.set(CHECKMARK_LENGTH);
      crossOffset.set(CROSS_LENGTH);
      colorProgress.set(0);
      rotation.set(withRepeat(withTiming(360, { duration: 1500, easing: Easing.linear }), -1));
      return () => cancelAnimation(rotation);
    }

    cancelAnimation(rotation);
    rotation.set(0);
    colorProgress.set(withTiming(1, { duration: 800, easing: Easing.out(Easing.ease) }));

    circleOffset.set(withTiming(0, { duration: 1000, easing: Easing.linear }));
    const symbolTiming = withDelay(
      1000,
      withTiming(0, { duration: 200, easing: Easing.out(Easing.ease) })
    );
    if (status === 'confirmed') {
      checkmarkOffset.set(symbolTiming);
      crossOffset.set(CROSS_LENGTH);
    } else {
      crossOffset.set(symbolTiming);
      checkmarkOffset.set(CHECKMARK_LENGTH);
    }
  }, [status, rotation, circleOffset, checkmarkOffset, crossOffset, colorProgress]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.get()}deg` }],
  }));

  const targetColor = status === 'failed' ? danger : success;
  const circleAnimatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circleOffset.get(),
    stroke: interpolateColor(colorProgress.get(), [0, 1], [foreground, targetColor]),
  }));

  const checkmarkAnimatedProps = useAnimatedProps(() => ({
    strokeDashoffset: checkmarkOffset.get(),
    stroke: interpolateColor(colorProgress.get(), [0, 1], [foreground, targetColor]),
  }));

  const crossAnimatedProps = useAnimatedProps(() => ({
    strokeDashoffset: crossOffset.get(),
    stroke: interpolateColor(colorProgress.get(), [0, 1], [foreground, targetColor]),
  }));

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[{ width: size, height: size }, containerStyle]}>
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <AnimatedPath
            d={CIRCLE_PATH}
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={CIRCLE_LENGTH}
            animatedProps={circleAnimatedProps}
          />
          <AnimatedPath
            d={CHECKMARK_PATH}
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={CHECKMARK_LENGTH}
            animatedProps={checkmarkAnimatedProps}
          />
          <AnimatedPath
            d={CROSS_PATH}
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={CROSS_LENGTH}
            animatedProps={crossAnimatedProps}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}
