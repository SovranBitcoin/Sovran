import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { Log } from '@/shared/lib/logger';
import { INVARIANT_WHITE } from '@/shared/lib/brandColors';

import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

// Android e2e only: the per-slide progress bar runs a continuous withTiming for
// the whole slide duration, so the window NEVER idles and Android's
// `uiautomator dump` intermittently fails ("could not get idle state") — the
// harness can't read the tree mid-carousel. iOS is unaffected (its serve-sim AX
// stream is push-based, no idle requirement) so it keeps the real animation.
// Under Android e2e the harness taps to advance, so the auto-advance animation
// is unnecessary: hold progress static (no withTiming) so the window can idle.
const E2E_MANUAL_SLIDES =
  Platform.OS === 'android' &&
  typeof __DEV__ === 'boolean' &&
  __DEV__ &&
  Number.isFinite(Number(process.env.EXPO_PUBLIC_E2E_ONBOARDING_SLIDE_MS));

type OnboardingPaginationItemProps = {
  index: number;
  currentSlideIndex: number;
  animatedSlideIndex: SharedValue<number>;
  inactiveWidth: number;
  activeWidth: number;
  totalSlides: number;
  slideDuration: number;
  isDragging: SharedValue<boolean>;
  handleScrollToIndex: (index: number) => void;
  translateY: SharedValue<number>;
  topCarouselOffset: number;
};

const OnboardingPaginationItem: React.FC<OnboardingPaginationItemProps> = ({
  index,
  currentSlideIndex,
  animatedSlideIndex,
  inactiveWidth,
  activeWidth,
  totalSlides,
  slideDuration,
  isDragging,
  handleScrollToIndex,
  translateY,
  topCarouselOffset,
}) => {
  const slideProgress = useSharedValue(0);

  const barWidth = useDerivedValue(() => {
    const adjustedIndex = animatedSlideIndex.get();

    let width = interpolate(
      adjustedIndex,
      [index - 1, index, index + 1],
      [inactiveWidth, activeWidth, inactiveWidth],
      Extrapolation.CLAMP
    );

    if (index === 0) {
      const loopFromLastWidth = interpolate(
        adjustedIndex,
        [totalSlides - 1, totalSlides],
        [inactiveWidth, activeWidth],
        Extrapolation.CLAMP
      );
      width = Math.max(width, loopFromLastWidth);
    }

    if (index === totalSlides - 1) {
      const loopToFirstWidth = interpolate(
        adjustedIndex,
        [totalSlides - 1, totalSlides],
        [activeWidth, inactiveWidth],
        Extrapolation.CLAMP
      );
      width = adjustedIndex >= totalSlides - 1 ? loopToFirstWidth : width;
    }

    return width;
  });

  const barWidthStyle = useAnimatedStyle(() => ({
    width: barWidth.get(),
  }));

  const barProgressStyle = useAnimatedStyle(() => {
    if (isDragging.get()) {
      cancelAnimation(slideProgress);
    }

    const progressWidth = interpolate(slideProgress.get(), [0, 1], [0, 100], Extrapolation.CLAMP);

    return {
      width: `${progressWidth}%`,
      opacity: interpolate(barWidth.get(), [0, activeWidth], [0, 1], Extrapolation.CLAMP),
    };
  });

  useEffect(() => {
    if (E2E_MANUAL_SLIDES) {
      // Static, no continuous animation → the window can idle for uiautomator.
      slideProgress.set(0);
      return;
    }
    if (currentSlideIndex === index) {
      slideProgress.set(0);
      slideProgress.set(withTiming(1, { duration: slideDuration }));
    } else {
      slideProgress.set(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSlideIndex]);

  useAnimatedReaction(
    () => ({ isDraggingVal: isDragging.get() }),
    ({ isDraggingVal }) => {
      if (E2E_MANUAL_SLIDES) return;
      if (!isDraggingVal && currentSlideIndex === index && slideProgress.get() > 0) {
        slideProgress.set(0);
        slideProgress.set(withTiming(1, { duration: slideDuration }));
      }
    }
  );

  useAnimatedReaction(
    () => ({ progress: slideProgress.get() }),
    ({ progress }) => {
      if (progress === 1 && currentSlideIndex === totalSlides - 1) {
        isDragging.set(true);
        translateY.set(
          withTiming(-topCarouselOffset, {
            duration: 200,
            easing: Easing.inOut(Easing.quad),
          })
        );
      }
      if (!isDragging.get() && progress === 1) {
        scheduleOnRN(handleScrollToIndex, currentSlideIndex + 1);
      }
    }
  );

  return (
    <Log name="OnboardingPaginationItem">
      <Animated.View
        style={[
          {
            height: 2,
            borderRadius: 999,
            backgroundColor: 'rgba(255,255,255,0.2)',
            overflow: 'hidden',
          },
          barWidthStyle,
        ]}>
        <Animated.View
          style={[
            { backgroundColor: INVARIANT_WHITE, position: 'absolute', top: 0, bottom: 0, left: 0 },
            barProgressStyle,
          ]}
        />
      </Animated.View>
    </Log>
  );
};

export default OnboardingPaginationItem;
