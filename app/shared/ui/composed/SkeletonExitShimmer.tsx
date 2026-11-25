import { useEffect, useId, useState } from 'react';
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
import { useScreenBackground } from '@/shared/ui/composed/ScreenFooterContext';
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
function useShimmerSweep(visualLayout: { onLayout?: (event: LayoutChangeEvent) => void }): {
  sweepWidth: number;
  handleLayout: (event: LayoutChangeEvent) => void;
} {
  const { width: screenWidth } = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState(0);
  const handleLayout = (event: LayoutChangeEvent) => {
    const w = Math.round(event.nativeEvent.layout.width);
    setContainerWidth((prev) => (prev === w ? prev : w));
    visualLayout.onLayout?.(event);
  };
  return { sweepWidth: containerWidth > 0 ? containerWidth : screenWidth, handleLayout };
}

// Internal timing — not exported (only this module reads them).
const SKELETON_LOADING_SHIMMER_DURATION_MS = 2200;
const SKELETON_LOADING_SHIMMER_GAP_MS = 350;

const LOADING_HIGHLIGHT_WIDTH_RATIO = 1.1;
const GRADIENT_LOCATIONS = [0, 0.5, 1] as const;
const GRADIENT_START = { x: 0, y: 0.5 } as const;
const GRADIENT_END = { x: 1, y: 0.5 } as const;

type SkeletonShimmerVisualProps = {
  visualScope?: string;
  visualKey?: string;
  visualSurface?: string;
  visualComponent?: string;
  visualPhase?: string;
  visualExtra?: VisualLayoutConfig['extra'];
  visualDisabled?: boolean;
};

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
  // Per-instance key via useId — the previous module-counter + lazy-ref-init
  // pattern was a render side effect the React Compiler refuses to compile
  // (every shimmer component rendered unmemoized).
  const instanceKey = `shimmer:${useId()}`;

  const reporter = useVisualLayoutLogger({
    enabled: visualDisabled !== true,
    scope: visualScope,
    surface: visualSurface,
    component: visualComponent ?? defaultComponent,
    itemKey: visualKey ? visualLayoutScopePart(visualKey) : instanceKey,
    itemType: defaultItemType,
    phase: visualPhase ?? (active ? defaultPhase : 'idle'),
    extra: () => ({
      active,
      ...(typeof visualExtra === 'function' ? visualExtra() : (visualExtra ?? {})),
    }),
  });
  // Destructured here, once for both shimmer components: the compiler can't
  // tell a `.ref` property read in JSX is a ref OBJECT and would skip the
  // consuming component ("Cannot access refs during render").
  const { ref: hostRef } = reporter;
  return { hostRef, onLayout: reporter.onLayout };
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
  const themeBackground = useThemeColor('surface');
  const background = useScreenBackground() ?? themeBackground;
  const progress = useSharedValue(0);
  const { hostRef, onLayout } = useSkeletonShimmerVisualLayout({
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

  const { sweepWidth, handleLayout } = useShimmerSweep({ onLayout });
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
        ref={hostRef}
        collapsable={false}
        onLayout={handleLayout}
        // An idle overlay covers its region: it must never take a tap meant
        // for what sits under it.
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
    );

  return (
    <View
      ref={hostRef}
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
