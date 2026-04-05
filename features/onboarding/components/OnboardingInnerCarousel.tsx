import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Platform, useWindowDimensions, ViewToken } from 'react-native';

import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlatList } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';

import OnboardingSlideItem from './OnboardingSlideItem';
import OnboardingPagination from './OnboardingPagination';
import { OnboardingCarouselProps, OnboardingSlide } from './types';
import { log, Log } from '@/shared/lib/logger';

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList<OnboardingSlide>);

const OnboardingInnerCarousel: React.FC<OnboardingCarouselProps> = ({
  setCurrentSlideIndex,
  horizontalListRef,
  scrollHandler,
  currentSlideIndex,
  translateY,
  scrollOffsetX,
  slides,
  isDragging,
  animatedSlideIndex,
  topCarouselOffset,
}) => {
  const [isHorizontalScrollEnabled, setIsHorizontalScrollEnabled] = useState(true);

  const data = useMemo(() => [...slides, slides[0]], [slides]);

  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0) {
        const viewableItem = viewableItems[0];
        if (viewableItem && viewableItem.index !== null) {
          log.info('onboarding.slide.change', { slideIndex: viewableItem.index });
          setCurrentSlideIndex(viewableItem.index);
        }
      }
    },
    [setCurrentSlideIndex]
  );

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 100,
    minimumViewTime: 0,
  }).current;

  const handleScrollToIndex = useCallback(
    (index: number) => {
      horizontalListRef.current?.scrollToIndex({
        index,
        animated: true,
      });
    },
    [horizontalListRef]
  );

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.get() }],
  }));

  const paginationStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateY.get(),
      [0, -topCarouselOffset * 0.25],
      [1, 0],
      Extrapolation.CLAMP
    ),
    pointerEvents: translateY.get() === 0 ? ('auto' as const) : ('none' as const),
  }));

  const isExpanded = useDerivedValue(() => translateY.get() <= -topCarouselOffset / 2);

  useAnimatedReaction(
    () => isExpanded.get(),
    (expanded) => {
      if (expanded) {
        scheduleOnRN(setIsHorizontalScrollEnabled, false);
      } else {
        scheduleOnRN(setIsHorizontalScrollEnabled, true);
      }
    }
  );

  return (
    <Log name="OnboardingInnerCarousel">
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: '100%',
          top: insets.top,
          height: screenHeight - insets.top - insets.bottom - 60,
        },
        containerStyle,
      ]}>
      <AnimatedFlatList
        ref={horizontalListRef}
        data={data}
        renderItem={({ item, index }) => (
          <OnboardingSlideItem
            item={item}
            index={index}
            width={screenWidth}
            scrollOffsetX={scrollOffsetX}
          />
        )}
        horizontal
        pagingEnabled
        initialScrollIndex={0}
        getItemLayout={(_, index) => ({
          length: screenWidth,
          offset: screenWidth * index,
          index,
        })}
        scrollEventThrottle={16}
        onScroll={scrollHandler}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onEndReached={() => {
          if (Platform.OS === 'android') {
            setTimeout(() => {
              horizontalListRef?.current?.scrollToIndex({ index: 0, animated: false });
            }, 100);
          } else {
            horizontalListRef?.current?.scrollToIndex({ index: 0, animated: false });
          }
        }}
        showsHorizontalScrollIndicator={false}
        scrollEnabled={isHorizontalScrollEnabled}
      />
      <Animated.View style={paginationStyle}>
        <OnboardingPagination
          slides={slides}
          currentSlideIndex={currentSlideIndex}
          animatedSlideIndex={animatedSlideIndex}
          isDragging={isDragging}
          handleScrollToIndex={handleScrollToIndex}
          translateY={translateY}
          topCarouselOffset={topCarouselOffset}
        />
      </Animated.View>
    </Animated.View>
    </Log>
  );
};

export default OnboardingInnerCarousel;
