import React, { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, useWindowDimensions } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';

import { useThemeColor } from '@/shared/hooks/useThemeColor';

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

export const SKELETON_EXIT_DURATION_MS = 620;
// Internal timing — not exported (only this module reads them).
const SKELETON_LOADING_SHIMMER_DURATION_MS = 2200;
const SKELETON_LOADING_SHIMMER_GAP_MS = 350;
const SKELETON_LOADING_SHIMMER_CYCLE_MS =
  SKELETON_LOADING_SHIMMER_DURATION_MS + SKELETON_LOADING_SHIMMER_GAP_MS;

/**
 * Returns ms to wait before triggering the exit so the in-flight loading
 * shimmer pass finishes first. If the shimmer is currently in its idle gap
 * (between passes) this returns 0 — there's no pass to interrupt.
 */
export function msUntilLoadingShimmerPassEnds(loadingStartedAt: number): number {
  const elapsed = Math.max(0, Date.now() - loadingStartedAt);
  const elapsedInCycle = elapsed % SKELETON_LOADING_SHIMMER_CYCLE_MS;
  if (elapsedInCycle < SKELETON_LOADING_SHIMMER_GAP_MS) return 0;
  return SKELETON_LOADING_SHIMMER_CYCLE_MS - elapsedInCycle;
}

const HIGHLIGHT_WIDTH = 90;
const LOADING_HIGHLIGHT_WIDTH_RATIO = 1.1;
const GRADIENT_LOCATIONS = [0, 0.5, 1] as const;
const GRADIENT_START = { x: 0, y: 0.5 } as const;
const GRADIENT_END = { x: 1, y: 0.5 } as const;
const EXIT_SHIMMER_BAR_BASE = { width: HIGHLIGHT_WIDTH } as const;

function shimmerColors(
  highlightColor: string | undefined,
  fallbackHighlight: string
): readonly [string, string, string] {
  if (highlightColor)
    return [opacity(highlightColor, 0), highlightColor, opacity(highlightColor, 0)];
  return ['transparent', fallbackHighlight, 'transparent'];
}

/**
 * Fades the wrapped skeleton out while a single bright shimmer line sweeps
 * across. The children stay mounted; only opacity changes. The shimmer line
 * is a separate absolute overlay.
 */
export function SkeletonExitReveal({
  active,
  children,
  highlightColor,
}: PropsWithChildren<{ active: boolean; highlightColor?: string }>) {
  const { width: screenWidth } = useWindowDimensions();
  const foreground = useThemeColor('foreground');
  const [containerWidth, setContainerWidth] = useState(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      cancelAnimation(progress);
      progress.set(0);
      return;
    }
    progress.set(0);
    progress.set(
      withTiming(1, { duration: SKELETON_EXIT_DURATION_MS, easing: Easing.out(Easing.cubic) })
    );
    return () => cancelAnimation(progress);
  }, [active, progress]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const w = Math.round(event.nativeEvent.layout.width);
    setContainerWidth((prev) => (prev === w ? prev : w));
  }, []);

  const sweepWidth = containerWidth > 0 ? containerWidth : screenWidth;

  const fadeStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.get(),
  }));

  const shimmerStyle = useAnimatedStyle(() => {
    const translateX = interpolate(
      progress.get(),
      [0, 1],
      [-HIGHLIGHT_WIDTH, sweepWidth + HIGHLIGHT_WIDTH]
    );
    return { transform: [{ translateX }] };
  });

  const gradientColors = useMemo<readonly [string, string, string]>(() => {
    return shimmerColors(highlightColor, opacity(foreground, 0.55));
  }, [foreground, highlightColor]);

  const shimmerBarStyle = useMemo(
    () => [styles.shimmerBar, EXIT_SHIMMER_BAR_BASE, shimmerStyle],
    [shimmerStyle]
  );

  return (
    <View onLayout={handleLayout} style={styles.container}>
      <Animated.View style={active ? fadeStyle : undefined}>{children}</Animated.View>
      {active && (
        <Animated.View pointerEvents="none" style={shimmerBarStyle}>
          <AnimatedLinearGradient
            colors={gradientColors}
            locations={GRADIENT_LOCATIONS}
            start={GRADIENT_START}
            end={GRADIENT_END}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

/**
 * Continuous single-shimmer overlay shown while the wrapped skeleton is in the
 * loading state. One bright highlight stripe sweeps left-to-right, pauses,
 * then repeats. Pure transform animation (native driver).
 */
export function SkeletonLoadingShimmer({
  active,
  highlightColor,
}: {
  active: boolean;
  highlightColor?: string;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const background = useThemeColor('background');
  const [containerWidth, setContainerWidth] = useState(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      cancelAnimation(progress);
      progress.set(0);
      return;
    }
    progress.set(0);
    progress.set(
      withRepeat(
        withDelay(
          SKELETON_LOADING_SHIMMER_GAP_MS,
          withTiming(1, {
            duration: SKELETON_LOADING_SHIMMER_DURATION_MS,
            easing: Easing.inOut(Easing.cubic),
          })
        ),
        -1,
        false
      )
    );
    return () => cancelAnimation(progress);
  }, [active, progress]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const w = Math.round(event.nativeEvent.layout.width);
    setContainerWidth((prev) => (prev === w ? prev : w));
  }, []);

  const sweepWidth = containerWidth > 0 ? containerWidth : screenWidth;
  const highlightWidth = Math.max(40, Math.round(sweepWidth * LOADING_HIGHLIGHT_WIDTH_RATIO));

  const shimmerStyle = useAnimatedStyle(() => {
    const translateX = interpolate(
      progress.get(),
      [0, 1],
      [-highlightWidth, sweepWidth + highlightWidth]
    );
    return { transform: [{ translateX }] };
  });

  const gradientColors = useMemo<readonly [string, string, string]>(() => {
    return shimmerColors(highlightColor, opacity(background, 0.85));
  }, [background, highlightColor]);

  const widthStyle = useMemo(() => ({ width: highlightWidth }), [highlightWidth]);
  const shimmerBarStyle = useMemo(
    () => [styles.shimmerBar, widthStyle, shimmerStyle],
    [shimmerStyle, widthStyle]
  );

  if (!active) return <View onLayout={handleLayout} style={StyleSheet.absoluteFill} />;

  return (
    <View onLayout={handleLayout} pointerEvents="none" style={styles.loadingContainer}>
      <Animated.View style={shimmerBarStyle} pointerEvents="none">
        <AnimatedLinearGradient
          colors={gradientColors}
          locations={GRADIENT_LOCATIONS}
          start={GRADIENT_START}
          end={GRADIENT_END}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  shimmerBar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
});
