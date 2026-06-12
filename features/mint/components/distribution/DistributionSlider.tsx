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
import { TOTAL_BASIS_POINTS } from '@/shared/stores/profile/mintDistributionStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';

const SLIDER_HEIGHT = 40;
const TOTAL_STEPS = 101;
const BP_PER_STEP = TOTAL_BASIS_POINTS / (TOTAL_STEPS - 1);
const BORDER_ALPHA = 0.22;

const INNER_SHADOW_TOP = ['rgba(0,0,0,0.25)', 'rgba(0,0,0,0.08)', 'transparent'] as const;
const INNER_HIGHLIGHT_BOTTOM = ['transparent', 'rgba(0,0,0,0.03)', 'rgba(0,0,0,0.08)'] as const;

interface DistributionSliderProps {
  value: SharedValue<number>;
  onValueChange?: (bp: number) => void;
  onValueCommit?: (bp: number) => void;
  disabled?: boolean;
  width: number;
  customGradientColors?: readonly [string, string];
  customBorderColor?: string;
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
  const [defaultColor, surfaceTertiary, surfaceSecondary, accent] = useThemeColor([
    'default',
    'surface-tertiary',
    'surface-secondary',
    'accent',
  ] as const);

  const gradientColors = useMemo(() => {
    if (isLoadingColors) return [surfaceTertiary, defaultColor] as const;
    if (customGradientColors) return customGradientColors;
    return [defaultColor, accent, defaultColor] as const;
  }, [isLoadingColors, customGradientColors, surfaceTertiary, defaultColor, accent]);

  const progressBorderColor = isLoadingColors
    ? 'rgba(255,255,255,0.10)'
    : opacity(customBorderColor || surfaceTertiary, BORDER_ALPHA);

  const stepWidth = width / TOTAL_STEPS;

  /**
   * Avoid reading `value.value` during React render (Reanimated strict-mode).
   * Initialize at 0, then sync via useAnimatedReaction / useEffect.
   */
  const progress = useSharedValue(0);
  const lastStepIndex = useSharedValue(0);
  const isActive = useSharedValue(false);

  React.useEffect(() => {
    const stepIndex = Math.round(value.value / BP_PER_STEP);
    const clampedStepIndex = Math.max(0, Math.min(stepIndex, TOTAL_STEPS - 1));
    const newProgress = (clampedStepIndex / (TOTAL_STEPS - 1)) * width;
    progress.value = newProgress;
    lastStepIndex.value = clampedStepIndex;
  }, [width, value, progress, lastStepIndex]);

  const fireHaptic = useCallback(() => {
    // expo-haptics works on both platforms — the old iOS guard silently
    // dropped slider feedback on Android.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const notifyValueChange = useCallback(
    (bp: number) => {
      onValueChange?.(bp);
    },
    [onValueChange]
  );

  const notifyValueCommit = useCallback(
    (bp: number) => {
      onValueCommit?.(bp);
    },
    [onValueCommit]
  );

  const gesture = useMemo(() => {
    return Gesture.Pan()
      .enabled(!disabled)
      .onBegin((event) => {
        'worklet';
        isActive.value = true;
        const tapX = event.x;

        const tappedStepIndex = Math.round(tapX / stepWidth);
        const clampedStepIndex = Math.max(0, Math.min(tappedStepIndex, TOTAL_STEPS - 1));

        const newProgress = (clampedStepIndex / (TOTAL_STEPS - 1)) * width;
        progress.value = newProgress;

        const newBp = Math.round(clampedStepIndex * BP_PER_STEP);
        value.value = newBp;

        lastStepIndex.value = clampedStepIndex;

        runOnJS(fireHaptic)();
        runOnJS(notifyValueChange)(newBp);
        runOnJS(notifyValueCommit)(newBp);
      })
      .onChange((event) => {
        'worklet';
        const currentX = event.x;

        const currentStepIndex = Math.round(currentX / stepWidth);
        const clampedStepIndex = Math.max(0, Math.min(currentStepIndex, TOTAL_STEPS - 1));

        if (clampedStepIndex !== lastStepIndex.value) {
          lastStepIndex.value = clampedStepIndex;

          const newProgress = (clampedStepIndex / (TOTAL_STEPS - 1)) * width;
          progress.value = newProgress;

          const newBp = Math.round(clampedStepIndex * BP_PER_STEP);
          value.value = newBp;

          runOnJS(fireHaptic)();
          runOnJS(notifyValueChange)(newBp);
        }
      })
      .onFinalize(() => {
        'worklet';
        isActive.value = false;

        const stepIndex = Math.round(value.value / BP_PER_STEP);
        const clampedStepIndex = Math.max(0, Math.min(stepIndex, TOTAL_STEPS - 1));
        const finalProgress = (clampedStepIndex / (TOTAL_STEPS - 1)) * width;
        progress.value = finalProgress;

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

  const progressStyle = useAnimatedStyle(() => {
    return {
      width: withSpring(progress.value, { damping: 140, stiffness: 1600 }),
    };
  });

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

  const stepMarkers = useMemo(() => {
    const markers = [];
    const majorSteps = [0, 25, 50, 75, 100];

    const markerColor = isLoadingColors
      ? 'rgba(255,255,255,0.10)'
      : opacity(customBorderColor || surfaceTertiary, BORDER_ALPHA);

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
              opacity: isMajor ? 1 : 0.5,
            },
          ]}
        />
      );
    }
    return markers;
  }, [width, surfaceTertiary, customBorderColor, isLoadingColors]);

  return (
    <Log name="DistributionSlider">
      <View style={{ width, height: SLIDER_HEIGHT }}>
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
                  backgroundColor: Platform.OS === 'android' ? surfaceSecondary : 'transparent',
                  borderColor: isLoadingColors
                    ? 'rgba(255,255,255,0.10)'
                    : opacity(customBorderColor || surfaceTertiary, BORDER_ALPHA),
                },
              ]}>
              {Platform.OS === 'ios' && (
                <BlurView style={StyleSheet.absoluteFill} tint="dark" intensity={40} />
              )}

              <View style={styles.markersContainer}>{stepMarkers}</View>

              <Animated.View
                style={[
                  styles.progressFill,
                  progressStyle,
                  {
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: progressBorderColor,
                  },
                ]}>
                <LinearGradient
                  colors={gradientColors}
                  locations={customGradientColors ? [0, 1] : [0, 0.5, 1]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.fullWidthGradient, { width }]}
                />
                <LinearGradient
                  colors={INNER_SHADOW_TOP}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={[styles.innerShadowTop, { width }]}
                />
                <LinearGradient
                  colors={INNER_HIGHLIGHT_BOTTOM}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={[styles.innerHighlightBottom, { width }]}
                />
              </Animated.View>
            </View>
          </Animated.View>
        </GestureDetector>
      </View>
    </Log>
  );
};

const styles = StyleSheet.create({
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
