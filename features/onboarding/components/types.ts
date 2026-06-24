import { SharedValue, useAnimatedScrollHandler } from 'react-native-reanimated';
import { FlatList } from 'react-native-gesture-handler';

export type OnboardingSlide = {
  bgColor: string;
  /** Duration in ms for the slide's auto-advance progress animation */
  duration: number;
  title: string;
  description: string;
  /** Monicon icon name displayed above the title */
  icon: string;
};

export type OnboardingCarouselProps = {
  slides: OnboardingSlide[];
  currentSlideIndex: number;
  setCurrentSlideIndex: (index: number) => void;
  horizontalListRef: React.RefObject<FlatList<OnboardingSlide> | null>;
  scrollHandler: ReturnType<typeof useAnimatedScrollHandler>;
  translateY: SharedValue<number>;
  scrollOffsetX: SharedValue<number>;
  isDragging: SharedValue<boolean>;
  animatedSlideIndex: SharedValue<number>;
  topCarouselOffset: number;
};
