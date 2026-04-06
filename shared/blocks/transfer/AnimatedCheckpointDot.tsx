/**
 * @fileoverview Shared animated checkpoint dot for timeline/chain UIs
 *
 * Used by TransferStepChain (rebalance plan) and HistoryEntryTimeline.
 * Supports opacity/scale transitions for future, pending, complete, failed,
 * rolled-back, already-spent, and current (spinning) states.
 */

import React, { useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';

import opacity from 'hex-color-opacity';
import Svg, { Circle } from 'react-native-svg';

import { Log } from '@/shared/lib/logger';
import Icon from 'assets/icons';
import Animated, {
  cancelAnimation,
  createAnimatedComponent,
  Easing,
  type EasingFunction,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

const AnimatedCircle = createAnimatedComponent(Circle);

export type CheckpointDotType =
  | 'complete'
  | 'current'
  | 'next-pending'
  | 'future'
  | 'future-small'
  | 'failed'
  | 'success'
  | 'rolled-back'
  | 'already-spent';

interface AnimatedCheckpointDotProps {
  type: CheckpointDotType;
  delayMs?: number;
  greenColor: string;
  redColor: string;
  orangeColor: string;
  greyColor: string;
}

const DOT_CONTAINER = 20;
const DOT_RADIUS_REF = 14;
const ICON_SIZE = 14;
const SMALL_DOT = ICON_SIZE / 2;

const DOT_ANIM_MS = 300;
const DOT_TIMING = { duration: DOT_ANIM_MS, easing: Easing.out(Easing.cubic) };
const FAST_TIMING = { duration: 200, easing: Easing.out(Easing.cubic) };

const SPINNER_RADIUS = 5;
const SPINNER_CIRCUMFERENCE = 2 * Math.PI * SPINNER_RADIUS;
const SPINNER_DASH_OFFSET = SPINNER_CIRCUMFERENCE * 0.7;

function timed(
  target: number,
  delayMs: number,
  config: { duration: number; easing: EasingFunction }
) {
  return delayMs > 0 ? withDelay(delayMs, withTiming(target, config)) : withTiming(target, config);
}

export const AnimatedCheckpointDot = React.memo(function AnimatedCheckpointDot({
  type,
  delayMs = 0,
  greenColor,
  redColor,
  orangeColor,
  greyColor,
}: AnimatedCheckpointDotProps) {
  const isFuture = type === 'future' || type === 'future-small';
  const isComplete = type === 'complete' || type === 'success';
  const isCurrent = type === 'current';
  const isPending = type === 'next-pending';
  const isFailed = type === 'failed';
  const isRolledBack = type === 'rolled-back';
  const isAlreadySpent = type === 'already-spent';

  const futureOp = useSharedValue(isFuture ? 1 : 0);
  const pendingOp = useSharedValue(isPending ? 1 : 0);
  const completeOp = useSharedValue(isComplete ? 1 : 0);
  const currentOp = useSharedValue(isCurrent ? 1 : 0);
  const failedOp = useSharedValue(isFailed ? 1 : 0);
  const rolledBackOp = useSharedValue(isRolledBack ? 1 : 0);
  const alreadySpentOp = useSharedValue(isAlreadySpent ? 1 : 0);
  const dotScale = useSharedValue(isFuture ? SMALL_DOT / DOT_CONTAINER : 1);
  const spinnerRotation = useSharedValue(0);

  useEffect(() => {
    futureOp.set(timed(isFuture ? 1 : 0, delayMs, FAST_TIMING));
    pendingOp.set(timed(isPending ? 1 : 0, delayMs, DOT_TIMING));
    completeOp.set(timed(isComplete ? 1 : 0, delayMs, DOT_TIMING));
    currentOp.set(timed(isCurrent ? 1 : 0, delayMs, DOT_TIMING));
    failedOp.set(timed(isFailed ? 1 : 0, delayMs, DOT_TIMING));
    rolledBackOp.set(timed(isRolledBack ? 1 : 0, delayMs, DOT_TIMING));
    alreadySpentOp.set(timed(isAlreadySpent ? 1 : 0, delayMs, DOT_TIMING));
    dotScale.set(timed(isFuture ? SMALL_DOT / DOT_CONTAINER : 1, delayMs, DOT_TIMING));

    if (isCurrent || isPending) {
      spinnerRotation.set(
        withDelay(
          delayMs,
          withRepeat(withTiming(360, { duration: 1500, easing: Easing.linear }), -1)
        )
      );
    } else {
      cancelAnimation(spinnerRotation);
      spinnerRotation.set(0);
    }

    return () => {
      if (!isCurrent && !isPending) return;
      cancelAnimation(spinnerRotation);
    };
  }, [
    type,
    delayMs,
    isFuture,
    isPending,
    isComplete,
    isCurrent,
    isFailed,
    isRolledBack,
    isAlreadySpent,
    futureOp,
    pendingOp,
    completeOp,
    currentOp,
    failedOp,
    rolledBackOp,
    alreadySpentOp,
    dotScale,
    spinnerRotation,
  ]);

  const scaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: dotScale.get() }],
  }));
  const futureStyle = useAnimatedStyle(() => ({ opacity: futureOp.get() }));
  const pendingStyle = useAnimatedStyle(() => ({ opacity: pendingOp.get() }));
  const completeStyle = useAnimatedStyle(() => ({ opacity: completeOp.get() }));
  const currentStyle = useAnimatedStyle(() => ({ opacity: currentOp.get() }));
  const failedStyle = useAnimatedStyle(() => ({ opacity: failedOp.get() }));
  const rolledBackStyle = useAnimatedStyle(() => ({ opacity: rolledBackOp.get() }));
  const alreadySpentStyle = useAnimatedStyle(() => ({ opacity: alreadySpentOp.get() }));

  const spinnerStyle = useAnimatedStyle(() => ({
    opacity: currentOp.get(),
    transform: [{ rotate: `${spinnerRotation.get()}deg` }],
  }));

  const pendingSpinnerStyle = useAnimatedStyle(() => ({
    opacity: pendingOp.get(),
    transform: [{ rotate: `${spinnerRotation.get()}deg` }],
  }));

  const spinnerCircleProps = useAnimatedProps(() => ({
    strokeDashoffset: SPINNER_DASH_OFFSET,
  }));

  const greenBg = useMemo(() => opacity(greenColor, 0.18), [greenColor]);
  const greenBorder = useMemo(() => opacity(greenColor, 0.32), [greenColor]);
  const greyBg = useMemo(() => opacity(greyColor, 0.18), [greyColor]);
  const greyBorder = useMemo(() => opacity(greyColor, 0.32), [greyColor]);
  const redBg = useMemo(() => opacity(redColor, 0.18), [redColor]);
  const redBorder = useMemo(() => opacity(redColor, 0.32), [redColor]);
  const orangeBg = useMemo(() => opacity(orangeColor, 0.18), [orangeColor]);
  const orangeBorder = useMemo(() => opacity(orangeColor, 0.32), [orangeColor]);
  const clockColor = useMemo(() => opacity('#FFFFFF', 0.7), []);

  return (
    <Log name="AnimatedCheckpointDot">
    <Animated.View style={[styles.dotWrapper, scaleStyle]}>
      <Animated.View
        style={[
          styles.dotLayer,
          { borderRadius: DOT_CONTAINER, backgroundColor: greyColor },
          futureStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.dotLayer,
          styles.dot,
          { backgroundColor: greyBg, borderColor: greyBorder },
          pendingStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.dotLayer,
          styles.dot,
          { backgroundColor: greenBg, borderColor: greenBorder },
          completeStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.dotLayer,
          styles.dot,
          { backgroundColor: greenBg, borderColor: greenBorder },
          currentStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.dotLayer,
          styles.dot,
          { backgroundColor: redBg, borderColor: redBorder },
          failedStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.dotLayer,
          styles.dot,
          { backgroundColor: orangeBg, borderColor: orangeBorder },
          rolledBackStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.dotLayer,
          styles.dot,
          { backgroundColor: orangeBg, borderColor: orangeBorder },
          alreadySpentStyle,
        ]}
      />

      <Animated.View style={[styles.iconLayer, pendingSpinnerStyle]}>
        <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 14 14">
          <AnimatedCircle
            cx={7}
            cy={7}
            r={5}
            fill="none"
            stroke={clockColor}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray={SPINNER_CIRCUMFERENCE}
            animatedProps={spinnerCircleProps}
          />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.iconLayer, completeStyle]}>
        <Icon name="fluent:checkmark-16-filled" color={greenColor} size={ICON_SIZE} />
      </Animated.View>
      <Animated.View style={[styles.iconLayer, spinnerStyle]}>
        <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 14 14">
          <AnimatedCircle
            cx={7}
            cy={7}
            r={5}
            fill="none"
            stroke={greenColor}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray={SPINNER_CIRCUMFERENCE}
            animatedProps={spinnerCircleProps}
          />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.iconLayer, failedStyle]}>
        <Icon name="material-symbols:close-rounded" color={redColor} size={ICON_SIZE} />
      </Animated.View>
      <Animated.View style={[styles.iconLayer, rolledBackStyle]}>
        <Icon name="ic:round-refresh" color={orangeColor} size={ICON_SIZE} />
      </Animated.View>
      <Animated.View style={[styles.iconLayer, alreadySpentStyle]}>
        <Icon name="mdi:alert-circle" color={orangeColor} size={ICON_SIZE} />
      </Animated.View>
    </Animated.View>
    </Log>
  );
});

const styles = StyleSheet.create({
  dotWrapper: {
    width: DOT_CONTAINER,
    height: DOT_CONTAINER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  dot: {
    width: DOT_CONTAINER,
    height: DOT_CONTAINER,
    borderRadius: DOT_RADIUS_REF / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    position: 'absolute',
    top: 0,
    left: 0,
  },
  iconLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
