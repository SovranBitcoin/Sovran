import { SharedValue } from 'react-native-reanimated';
// ast-grep-ignore: flatlist-outside-list-seam-ts
// Ref type for OnboardingInnerCarousel's RNGH FlatList pager (see the
// exemption there) — type-only, no list is rendered here.
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
  scrollHandler: (event: any) => void;
  translateY: SharedValue<number>;
  scrollOffsetX: SharedValue<number>;
  isDragging: SharedValue<boolean>;
  animatedSlideIndex: SharedValue<number>;
  topCarouselOffset: number;
};
