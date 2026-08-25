import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
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
import { withAlpha } from '@/shared/lib/color';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import {
  useVisualLayoutLogger,
  visualLayoutScopePart,
  type VisualLayoutConfig,
} from '@/shared/lib/contentShiftLog';

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

/**
 * Width the shimmer sweeps across, plus the layout handler that measures it.
 *
 * The container's own width is authoritative once measured; the screen width is
 * the pre-measure stand-in so the very first frame still sweeps a sane
 * distance. Rounding plus the equality guard keeps sub-pixel layout jitter from
 * re-rendering the sweep. The caller's visual-layout logger still sees every
 * layout event.
 */
function useShimmerSweep(visualLayout: { onLayout: (event: LayoutChangeEvent) => void }): {
  sweepWidth: number;
  handleLayout: (event: LayoutChangeEvent) => void;
} {
  const { width: screenWidth } = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState(0);
  const handleLayout = (event: LayoutChangeEvent) => {
    const w = Math.round(event.nativeEvent.layout.width);
    setContainerWidth((prev) => (prev === w ? prev : w));
    visualLayout.onLayout(event);
  };
  return { sweepWidth: containerWidth > 0 ? containerWidth : screenWidth, handleLayout };
}

const SKELETON_EXIT_DURATION_MS = 620;
// Internal timing — not exported (only this module reads them).
const SKELETON_LOADING_SHIMMER_DURATION_MS = 2200;
const SKELETON_LOADING_SHIMMER_GAP_MS = 350;

const HIGHLIGHT_WIDTH = 90;
const LOADING_HIGHLIGHT_WIDTH_RATIO = 1.1;
const GRADIENT_LOCATIONS = [0, 0.5, 1] as const;
const GRADIENT_START = { x: 0, y: 0.5 } as const;
const GRADIENT_END = { x: 1, y: 0.5 } as const;
const EXIT_SHIMMER_BAR_BASE = { width: HIGHLIGHT_WIDTH } as const;

type SkeletonShimmerVisualProps = {
  visualScope?: string;
  visualKey?: string;
  visualSurface?: string;
  visualComponent?: string;
  visualPhase?: string;
  visualExtra?: VisualLayoutConfig['extra'];
  visualDisabled?: boolean;
};

let skeletonShimmerVisualInstance = 0;

function useSkeletonShimmerVisualLayout({
  active,
  defaultComponent,
  defaultItemType,
  defaultPhase,
  visualScope = 'loading.skeleton_shimmer',
  visualKey,
  visualSurface = 'shared',
  visualComponent,
  visualPhase,
  visualExtra,
  visualDisabled,
}: SkeletonShimmerVisualProps & {
  active: boolean;
  defaultComponent: string;
  defaultItemType: string;
  defaultPhase: string;
}) {
  const instanceKeyRef = useRef<string | null>(null);
  if (instanceKeyRef.current === null) {
    skeletonShimmerVisualInstance += 1;
    instanceKeyRef.current = `shimmer:${skeletonShimmerVisualInstance}`;
  }

  return useVisualLayoutLogger({
    enabled: visualDisabled !== true,
    scope: visualScope,
    surface: visualSurface,
    component: visualComponent ?? defaultComponent,
    itemKey: visualKey ? visualLayoutScopePart(visualKey) : instanceKeyRef.current,
    itemType: defaultItemType,
    phase: visualPhase ?? (active ? defaultPhase : 'idle'),
    extra: () => ({
      active,
      ...(typeof visualExtra === 'function' ? visualExtra() : (visualExtra ?? {})),
    }),
  });
}

function shimmerColors(
  highlightColor: string | undefined,
  fallbackHighlight: string
): readonly [string, string, string] {
  if (highlightColor)
    return [withAlpha(highlightColor, 0), highlightColor, withAlpha(highlightColor, 0)];
  return ['transparent', fallbackHighlight, 'transparent'];
}

function ShimmerGradient({ colors }: { colors: readonly [string, string, string] }) {
  return (
    <AnimatedLinearGradient
      colors={colors}
      locations={GRADIENT_LOCATIONS}
      start={GRADIENT_START}
      end={GRADIENT_END}
      style={StyleSheet.absoluteFill}
    />
  );
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
  ...visualProps
}: PropsWithChildren<{ active: boolean; highlightColor?: string } & SkeletonShimmerVisualProps>) {
  const foreground = useThemeColor('foreground');
  const progress = useSharedValue(0);
  const visualLayout = useSkeletonShimmerVisualLayout({
    active,
    defaultComponent: 'SkeletonExitReveal',
    defaultItemType: 'skeleton-exit-shimmer',
    defaultPhase: 'exiting',
    ...visualProps,
  });

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

  const { sweepWidth, handleLayout } = useShimmerSweep(visualLayout);

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

  const gradientColors = shimmerColors(highlightColor, withAlpha(foreground, 0.55));

  const shimmerBarStyle = [styles.shimmerBar, EXIT_SHIMMER_BAR_BASE, shimmerStyle];

  return (
    <View ref={visualLayout.ref} collapsable={false} onLayout={handleLayout}>
      <Animated.View style={active ? fadeStyle : undefined}>{children}</Animated.View>
      {active && (
        <Animated.View pointerEvents="none" style={shimmerBarStyle}>
          <ShimmerGradient colors={gradientColors} />
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
  ...visualProps
}: {
  active: boolean;
  highlightColor?: string;
} & SkeletonShimmerVisualProps) {
  const background = useThemeColor('background');
  const progress = useSharedValue(0);
  const visualLayout = useSkeletonShimmerVisualLayout({
    active,
    defaultComponent: 'SkeletonLoadingShimmer',
    defaultItemType: 'skeleton-loading-shimmer',
    defaultPhase: 'loading',
    ...visualProps,
  });

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

  const { sweepWidth, handleLayout } = useShimmerSweep(visualLayout);
  const highlightWidth = Math.max(40, Math.round(sweepWidth * LOADING_HIGHLIGHT_WIDTH_RATIO));

  const shimmerStyle = useAnimatedStyle(() => {
    const translateX = interpolate(
      progress.get(),
      [0, 1],
      [-highlightWidth, sweepWidth + highlightWidth]
    );
    return { transform: [{ translateX }] };
  });

  const gradientColors = shimmerColors(highlightColor, withAlpha(background, 0.85));

  const shimmerBarStyle = [styles.shimmerBar, { width: highlightWidth }, shimmerStyle];

  if (!active)
    return (
      <View
        ref={visualLayout.ref}
        collapsable={false}
        onLayout={handleLayout}
        style={StyleSheet.absoluteFill}
      />
    );

  return (
    <View
      ref={visualLayout.ref}
      collapsable={false}
      onLayout={handleLayout}
      pointerEvents="none"
      style={styles.loadingContainer}>
      <Animated.View style={shimmerBarStyle} pointerEvents="none">
        <ShimmerGradient colors={gradientColors} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
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
