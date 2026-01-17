/**
 * @fileoverview Distribution Slider Component
 *
 * Adapted from the Opal timer slider pattern for mint distribution percentages.
 * Uses basis points (0-10,000) internally, displayed as percentages (0-100%).
 *
 * Features:
 * - Discrete step snapping (1% increments = 100 bp)
 * - Spring animation for smooth progress updates
 * - Haptic feedback on step changes (iOS)
 * - Rubber band container for elastic feel
 * - Allows 0% selection (unlike timer which clamps to [1, N-1])
 */

import React, { FC, useCallback, useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import opacity from 'hex-color-opacity';
import { useTheme } from 'providers/ThemeProvider';
import { TOTAL_BASIS_POINTS } from 'stores/mintDistributionStore';

// Slider dimensions
const SLIDER_HEIGHT = 40;

// Step configuration: 101 steps (0-100%)
const TOTAL_STEPS = 101;
const BP_PER_STEP = TOTAL_BASIS_POINTS / (TOTAL_STEPS - 1); // 100 bp per step

interface DistributionSliderProps {
  /** Current value in basis points (0-10,000) */
  value: SharedValue<number>;
  /** Callback when value changes (called from JS thread) */
  onValueChange?: (bp: number) => void;
  /** Callback when gesture ends with final value */
  onValueCommit?: (bp: number) => void;
  /** Whether the slider is disabled */
  disabled?: boolean;
  /** Width of the slider (required for proper gesture calculation) */
  width: number;
  /** Custom gradient colors [startColor, endColor] - extracted from mint icon */
  customGradientColors?: readonly [string, string];
  /** Custom border color - extracted from mint icon */
  customBorderColor?: string;
  /** Whether colors are still loading */
  isLoadingColors?: boolean;
}

export const DistributionSlider: FC<DistributionSliderProps> = ({
  value,
  onValueChange,
  onValueCommit,
  disabled = false,
  width,
  customGradientColors,
  customBorderColor,
  isLoadingColors = false,
}) => {
  const { getPrimaryColor } = useTheme();
  const primaryColor600 = useMemo(() => getPrimaryColor('600'), [getPrimaryColor]);
  const primaryColor700 = useMemo(() => getPrimaryColor('700'), [getPrimaryColor]);
  const primaryColor800 = useMemo(() => getPrimaryColor('800'), [getPrimaryColor]);

  // Skeleton colors for loading state - subtle animated placeholder
  const skeletonColor1 = useMemo(() => getPrimaryColor('700'), [getPrimaryColor]);
  const skeletonColor2 = useMemo(() => getPrimaryColor('600'), [getPrimaryColor]);

  // Use custom colors if provided, skeleton colors when loading, otherwise fall back to theme colors
  const gradientColors = useMemo(() => {
    if (isLoadingColors) {
      // Skeleton: subtle theme-based gradient while loading
      return [skeletonColor1, skeletonColor2] as const;
    }
    if (customGradientColors) {
      // Custom: use provided colors in a 2-stop gradient
      return customGradientColors;
    }
    // Default: theme gradient with convex highlight
    return [primaryColor600, getPrimaryColor('500'), primaryColor600] as const;
  }, [
    isLoadingColors,
    customGradientColors,
    skeletonColor1,
    skeletonColor2,
    primaryColor600,
    getPrimaryColor,
  ]);

  // Border color: skeleton when loading, custom, or fall back to subtle white
  const borderAlpha = 0.22; // keep slider borders consistent with CTA/button borders in the mint card
  const progressBorderColor = isLoadingColors
    ? 'rgba(255,255,255,0.10)'
    : opacity(customBorderColor || primaryColor700, borderAlpha);

  // Inner shadow - top darker (inset), bottom lighter (subtle lift) - shadcn style
  const innerShadowTop = useMemo(
    () => ['rgba(0,0,0,0.25)', 'rgba(0,0,0,0.08)', 'transparent'] as const,
    []
  );

  // Bottom highlight for depth
  const innerHighlightBottom = useMemo(
    () => ['transparent', 'rgba(0,0,0,0.03)', 'rgba(0,0,0,0.08)'] as const,
    []
  );

  const stepWidth = width / TOTAL_STEPS;

  // Shared values for slider state
  /**
   * NOTE (perf / Reanimated strict-mode):
   * Avoid reading `value.value` during React render.
   *
   * Reanimated warns when shared values are read while React is rendering.
   * We initialize at 0 here, then immediately synchronize using:
   * - `useAnimatedReaction` (UI thread) for external store updates
   * - a small `useEffect` (JS thread) when `width` changes
   */
  const progress = useSharedValue(0);
  const lastStepIndex = useSharedValue(0);
  const isActive = useSharedValue(false);

  // Sync progress when width changes (e.g., orientation change)
  React.useEffect(() => {
    // Width can change from layout measurement; recompute progress from current value.
    const stepIndex = Math.round(value.value / BP_PER_STEP);
    const clampedStepIndex = Math.max(0, Math.min(stepIndex, TOTAL_STEPS - 1));
    const newProgress = (clampedStepIndex / (TOTAL_STEPS - 1)) * width;
    progress.value = newProgress;
    lastStepIndex.value = clampedStepIndex;
  }, [width, value, progress, lastStepIndex]);

  // Fire haptic feedback (must be called from JS thread)
  const fireHaptic = useCallback(() => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  // Notify value change during drag (must be called from JS thread)
  const notifyValueChange = useCallback(
    (bp: number) => {
      onValueChange?.(bp);
    },
    [onValueChange]
  );

  // Notify value commit on gesture end (must be called from JS thread)
  const notifyValueCommit = useCallback(
    (bp: number) => {
      onValueCommit?.(bp);
    },
    [onValueCommit]
  );

  // Pan gesture for slider interaction
  const gesture = useMemo(() => {
    return Gesture.Pan()
      .enabled(!disabled)
      .onBegin((event) => {
        'worklet';
        isActive.value = true;
        const tapX = event.x;

        // Calculate step index from tap position (allow 0 to TOTAL_STEPS-1)
        const tappedStepIndex = Math.round(tapX / stepWidth);
        const clampedStepIndex = Math.max(0, Math.min(tappedStepIndex, TOTAL_STEPS - 1));

        // Update progress
        const newProgress = (clampedStepIndex / (TOTAL_STEPS - 1)) * width;
        progress.value = newProgress;

        // Calculate new bp value
        const newBp = Math.round(clampedStepIndex * BP_PER_STEP);
        value.value = newBp;

        lastStepIndex.value = clampedStepIndex;

        // Fire haptic and notify on JS thread
        runOnJS(fireHaptic)();
        runOnJS(notifyValueChange)(newBp);
        // Also commit immediately for tap support (taps don't always trigger onFinalize reliably)
        runOnJS(notifyValueCommit)(newBp);
      })
      .onChange((event) => {
        'worklet';
        const currentX = event.x;

        // Calculate step index
        const currentStepIndex = Math.round(currentX / stepWidth);
        const clampedStepIndex = Math.max(0, Math.min(currentStepIndex, TOTAL_STEPS - 1));

        // Only update when step changes
        if (clampedStepIndex !== lastStepIndex.value) {
          lastStepIndex.value = clampedStepIndex;

          const newProgress = (clampedStepIndex / (TOTAL_STEPS - 1)) * width;
          progress.value = newProgress;

          const newBp = Math.round(clampedStepIndex * BP_PER_STEP);
          value.value = newBp;

          // Fire haptic and notify on JS thread
          runOnJS(fireHaptic)();
          runOnJS(notifyValueChange)(newBp);
        }
      })
      .onFinalize(() => {
        'worklet';
        isActive.value = false;

        // Explicitly sync progress to current value (ensures visual matches after tap)
        const stepIndex = Math.round(value.value / BP_PER_STEP);
        const clampedStepIndex = Math.max(0, Math.min(stepIndex, TOTAL_STEPS - 1));
        const finalProgress = (clampedStepIndex / (TOTAL_STEPS - 1)) * width;
        progress.value = finalProgress;

        // Commit the final value to the store
        runOnJS(notifyValueCommit)(value.value);
      });
  }, [
    disabled,
    stepWidth,
    width,
    progress,
    value,
    lastStepIndex,
    isActive,
    fireHaptic,
    notifyValueChange,
    notifyValueCommit,
  ]);

  // Sync slider when value changes externally (from parent via useEffect)
  // Always sync regardless of isActive - during gesture we set the same value anyway
  useAnimatedReaction(
    () => value.value,
    (newValue, prevValue) => {
      if (newValue !== prevValue) {
        const stepIndex = Math.round(newValue / BP_PER_STEP);
        const clampedStepIndex = Math.max(0, Math.min(stepIndex, TOTAL_STEPS - 1));
        const newProgress = (clampedStepIndex / (TOTAL_STEPS - 1)) * width;
        progress.value = newProgress;
        lastStepIndex.value = clampedStepIndex;
      }
    },
    [width]
  );

  // Animated progress bar style with spring
  const progressStyle = useAnimatedStyle(() => {
    return {
      width: withSpring(progress.value, { damping: 140, stiffness: 1600 }),
    };
  });

  // Active scale style for press feedback
  const containerScaleStyle = useAnimatedStyle(() => {
    return {
      transform: [
        {
          scale: isActive.value
            ? withSpring(1.02, { duration: 300 })
            : withSpring(1, { duration: 500, dampingRatio: 0.4 }),
        },
      ],
    };
  });

  // Generate step markers
  const stepMarkers = useMemo(() => {
    const markers = [];
    // Show markers at 0%, 25%, 50%, 75%, 100%
    const majorSteps = [0, 25, 50, 75, 100];

    // When a mint provides extracted colors, tint the markers so they feel “owned” by that mint.
    // Keep them subtle via opacity so they don't fight the progress fill.
    const markerColor = isLoadingColors
      ? 'rgba(255,255,255,0.10)'
      : opacity(customBorderColor || primaryColor700, borderAlpha);

    for (let i = 0; i <= 100; i += 5) {
      const isMajor = majorSteps.includes(i);
      markers.push(
        <View
          key={i}
          style={[
            styles.stepMarker,
            {
              left: (i / 100) * width - 1,
              height: isMajor ? '100%' : '50%',
              backgroundColor: markerColor,
              // Major ticks match the slider border style; minor ticks are the same style, just quieter.
              opacity: isMajor ? 1 : 0.5,
            },
          ]}
        />
      );
    }
    return markers;
  }, [width, primaryColor700, customBorderColor, isLoadingColors]);

  return (
    <View style={[styles.wrapper, { width, height: SLIDER_HEIGHT }]}>
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[
            styles.innerWrapper,
            { width, height: SLIDER_HEIGHT, opacity: disabled ? 0.5 : 1 },
            containerScaleStyle,
          ]}>
          <View
            style={[
              styles.container,
              {
                backgroundColor: Platform.OS === 'android' ? primaryColor800 : 'transparent',
                borderColor: isLoadingColors
                  ? 'rgba(255,255,255,0.10)'
                  : opacity(customBorderColor || primaryColor700, borderAlpha),
              },
            ]}>
            {/* iOS blur background */}
            {Platform.OS === 'ios' && (
              <BlurView style={StyleSheet.absoluteFill} tint="dark" intensity={40} />
            )}

            {/* Step markers */}
            <View style={styles.markersContainer}>{stepMarkers}</View>

            {/* Progress fill - clips the full-width gradient to reveal it */}
            <Animated.View
              style={[
                styles.progressFill,
                progressStyle,
                {
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: progressBorderColor,
                },
              ]}>
              {/* Base gradient */}
              <LinearGradient
                colors={gradientColors}
                locations={customGradientColors ? [0, 1] : [0, 0.5, 1]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.fullWidthGradient, { width }]}
              />
              {/* Inner shadow - top inset (shadcn style) */}
              <LinearGradient
                colors={innerShadowTop}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={[styles.innerShadowTop, { width }]}
              />
              {/* Bottom highlight for subtle lift */}
              <LinearGradient
                colors={innerHighlightBottom}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={[styles.innerHighlightBottom, { width }]}
              />
            </Animated.View>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    // Full width within parent
  },
  innerWrapper: {
    flex: 1,
  },
  container: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  markersContainer: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepMarker: {
    position: 'absolute',
    width: 2,
    borderRadius: 1,
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 12,
    overflow: 'hidden',
  },
  fullWidthGradient: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  innerShadowTop: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: '50%',
  },
  innerHighlightBottom: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: '50%',
  },
});
