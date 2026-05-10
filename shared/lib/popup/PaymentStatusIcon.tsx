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

import { STATUS_PATH, STATUS_LENGTH, STATUS_OFFSET } from './animatedStatusShapes';

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
  // those start at the STATUS_OFFSET.pendingCircle / *_LENGTH defaults below.
  const isInitialConfirmed = status === 'confirmed';
  const isInitialFailed = status === 'failed';
  const isInitialTerminal = isInitialConfirmed || isInitialFailed;
  const rotation = useSharedValue(0);
  const circleOffset = useSharedValue(isInitialTerminal ? 0 : STATUS_OFFSET.pendingCircle);
  const checkmarkOffset = useSharedValue(isInitialConfirmed ? 0 : STATUS_LENGTH.checkmark);
  const crossOffset = useSharedValue(isInitialFailed ? 0 : STATUS_LENGTH.cross);
  const colorProgress = useSharedValue(isInitialTerminal ? 1 : 0);

  useEffect(() => {
    if (status === 'pending' || status === 'delivered') {
      circleOffset.set(STATUS_OFFSET.pendingCircle);
      checkmarkOffset.set(STATUS_LENGTH.checkmark);
      crossOffset.set(STATUS_LENGTH.cross);
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
      crossOffset.set(STATUS_LENGTH.cross);
    } else {
      crossOffset.set(symbolTiming);
      checkmarkOffset.set(STATUS_LENGTH.checkmark);
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
            d={STATUS_PATH.circle}
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={STATUS_LENGTH.circle}
            animatedProps={circleAnimatedProps}
          />
          <AnimatedPath
            d={STATUS_PATH.checkmark}
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={STATUS_LENGTH.checkmark}
            animatedProps={checkmarkAnimatedProps}
          />
          <AnimatedPath
            d={STATUS_PATH.cross}
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={STATUS_LENGTH.cross}
            animatedProps={crossAnimatedProps}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}
