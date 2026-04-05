import React from 'react';
import { View, useWindowDimensions } from 'react-native';

import { SharedValue } from 'react-native-reanimated';

import OnboardingPaginationItem from './OnboardingPaginationItem';
import { OnboardingSlide } from './types';
import { Log } from '@/shared/lib/logger';

type OnboardingPaginationProps = {
  slides: OnboardingSlide[];
  currentSlideIndex: number;
  animatedSlideIndex: SharedValue<number>;
  isDragging: SharedValue<boolean>;
  handleScrollToIndex: (index: number) => void;
  translateY: SharedValue<number>;
  topCarouselOffset: number;
};

const OnboardingPagination: React.FC<OnboardingPaginationProps> = ({
  slides,
  currentSlideIndex,
  animatedSlideIndex,
  isDragging,
  handleScrollToIndex,
  translateY,
  topCarouselOffset,
}) => {
  const { width: screenWidth } = useWindowDimensions();

  const HORIZONTAL_PADDING = screenWidth * 0.25;
  const GAP = 3;

  const totalPaginationWidth = screenWidth - HORIZONTAL_PADDING;
  const totalGaps = (slides.length - 1) * GAP;

  const totalItems = slides.length + 2;
  const itemWidth = (totalPaginationWidth - totalGaps) / totalItems;

  const inactiveWidth = itemWidth;
  const activeWidth = itemWidth * 3;

  return (
    <Log name="OnboardingPagination">
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingBottom: 16,
        paddingHorizontal: HORIZONTAL_PADDING / 2,
        gap: GAP,
      }}>
      {slides.map((slide, index) => (
        <OnboardingPaginationItem
          key={index}
          index={index}
          currentSlideIndex={currentSlideIndex}
          animatedSlideIndex={animatedSlideIndex}
          inactiveWidth={inactiveWidth}
          activeWidth={activeWidth}
          totalSlides={slides.length}
          isDragging={isDragging}
          slideDuration={slide.duration}
          handleScrollToIndex={handleScrollToIndex}
          translateY={translateY}
          topCarouselOffset={topCarouselOffset}
        />
      ))}
    </View>
    </Log>
  );
};

export default OnboardingPagination;
