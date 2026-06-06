import React, { useCallback, useRef, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { PressableFeedback } from 'heroui-native';

import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlatList, Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import { scheduleOnRN } from 'react-native-worklets';

import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Text } from '@/shared/ui/primitives/Text';
import { log, useLifecycleLogger, Log } from '@/shared/lib/logger';
import OnboardingInnerCarousel from './OnboardingInnerCarousel';
import { OnboardingSlide } from './types';

/**
 * Distance in pixels to translate carousel upward when fully expanded.
 * Reveals the welcome text + "Get Started" button below the carousel.
 */
const TOP_CAROUSEL_OFFSET = 230;
/** Minimum swipe distance (px) to trigger expand/collapse transition */
const SWIPE_UP_THRESHOLD = 20;

type OnboardingScreenProps = {
  onComplete: () => void;
};

const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ onComplete }) => {
  useLifecycleLogger('OnboardingScreen');
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);

  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  const [background, foreground, muted, orange300, purple300, blue300, shade300] = useThemeColor([
    'background',
    'foreground',
    'muted',
    'orange-300',
    'purple-300',
    'blue-300',
    'shade-300',
  ] as const);

  const slides: OnboardingSlide[] = [
    {
      bgColor: orange300,
      duration: 3000,
      title: 'Bitcoin that feels like cash',
      description:
        'Send and receive instantly with near-zero fees. Ecash bearer tokens live on your device \u2014 like digital cash.',
      icon: 'mdi:bitcoin',
    },
    {
      bgColor: purple300,
      duration: 3000,
      title: 'Powered by Nostr',
      description:
        'SOVRAN runs on Nostr, a decentralized network that can\u2019t be shut down or censored.',
      icon: 'mdi:broadcast',
    },
    {
      bgColor: blue300,
      duration: 3000,
      title: 'Private by Design',
      description:
        'Blind signatures mean mints can\u2019t link your transactions. Choose mints you trust \u2014 spread your balance across many.',
      icon: 'mdi:key-variant',
    },
    {
      bgColor: shade300,
      duration: 3000,
      title: 'Stay private, stay sovereign',
      description:
        'You\u2019re all set. Start sending and receiving bitcoin instantly. Welcome to freedom.',
      icon: 'mdi:shield-check',
    },
  ];

  const horizontalListRef = useRef<FlatList<OnboardingSlide>>(null);

  const animatedSlideIndex = useSharedValue(0);
  const scrollOffsetX = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const translateY = useSharedValue(0);
  const gestureStartY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onBeginDrag: () => {
      isDragging.set(true);
    },
    onScroll: (event) => {
      const offsetX = event.contentOffset.x;
      scrollOffsetX.set(offsetX);
      animatedSlideIndex.set(offsetX / screenWidth);
    },
    onEndDrag: () => {
      isDragging.set(false);
    },
  });

  const handleScrollToIndex = useCallback((index: number) => {
    horizontalListRef.current?.scrollToIndex({
      index,
      animated: true,
    });
  }, []);

  const singleTap = Gesture.Tap()
    .maxDuration(250)
    .onStart(() => {
      if (translateY.get() < 0) return;
      scheduleOnRN(handleScrollToIndex, currentSlideIndex + 1);
      isDragging.set(false);
    });

  const panGesture = Gesture.Pan()
    .onBegin(() => {
      isDragging.set(true);
      gestureStartY.set(translateY.get());
    })
    .onUpdate((e) => {
      if (translateY.get() <= -TOP_CAROUSEL_OFFSET && e.translationY < 0) {
        return;
      }
      const proposed = gestureStartY.get() + e.translationY / 4;
      const clamped = Math.min(0, Math.max(proposed, -TOP_CAROUSEL_OFFSET));
      translateY.set(clamped);
    })
    .onEnd(() => {
      const currentY = translateY.get();
      const isExpanded = currentY < 0;

      const isTopThresholdReached =
        Math.abs(gestureStartY.get()) - Math.abs(currentY) > SWIPE_UP_THRESHOLD;
      const isBottomThresholdReached =
        Math.abs(currentY) - Math.abs(gestureStartY.get()) > SWIPE_UP_THRESHOLD;

      const expandedPositionMap = isTopThresholdReached ? 0 : -TOP_CAROUSEL_OFFSET;
      const collapsedPositionMap = isBottomThresholdReached ? -TOP_CAROUSEL_OFFSET : 0;

      const target = isExpanded ? expandedPositionMap : collapsedPositionMap;

      translateY.set(
        withSpring(target, {}, (finished) => {
          if (finished && target === 0) {
            isDragging.set(false);
          }
        })
      );
    });

  const welcomeBlockStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.get(), [0, -TOP_CAROUSEL_OFFSET], [0, 1], Extrapolation.CLAMP),
  }));

  const gradientStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.get(), [0, -TOP_CAROUSEL_OFFSET], [0, 1], Extrapolation.CLAMP),
  }));

  const onGetStartedPress = () => {
    log.info('onboarding.completed', { slidesSeen: currentSlideIndex + 1 });
    onComplete();
  };

  const onChevronDownPress = () => {
    isDragging.set(false);
    translateY.set(withTiming(0, { duration: 300 }));
  };

  return (
    <Log name="OnboardingScreen">
      <View style={{ flex: 1, backgroundColor: background, paddingBottom: insets.bottom + 10 }}>
        <Animated.View style={[{ marginTop: 'auto' }, welcomeBlockStyle]}>
          <Pressable style={{ alignSelf: 'center', marginBottom: 24 }} onPress={onChevronDownPress}>
            <Icon name="mdi:chevron-down" size={24} color={muted} />
          </Pressable>
          <Text bold size={28} style={{ color: foreground, textAlign: 'center' }}>
            Welcome to Sovran
          </Text>
          <Text size={15} style={{ color: muted, textAlign: 'center', marginTop: 12 }}>
            Your keys, your money, your freedom.
          </Text>
        </Animated.View>

        <PressableFeedback
          onPress={onGetStartedPress}
          style={{
            height: 48,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 999,
            marginHorizontal: 80,
            marginTop: 24,
            backgroundColor: foreground,
            overflow: 'hidden',
          }}>
          <PressableFeedback.Highlight />
          <Text bold size={16} style={{ color: background }}>
            Get Started
          </Text>
        </PressableFeedback>

        <GestureDetector gesture={Gesture.Race(panGesture, singleTap)}>
          <OnboardingInnerCarousel
            slides={slides}
            currentSlideIndex={currentSlideIndex}
            setCurrentSlideIndex={setCurrentSlideIndex}
            animatedSlideIndex={animatedSlideIndex}
            horizontalListRef={horizontalListRef}
            scrollHandler={scrollHandler}
            translateY={translateY}
            scrollOffsetX={scrollOffsetX}
            isDragging={isDragging}
            topCarouselOffset={TOP_CAROUSEL_OFFSET}
          />
        </GestureDetector>

        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, gradientStyle]}>
          <LinearGradient
            colors={['rgba(0,0,0,0.6)', 'transparent']}
            style={{ width: '100%', height: '60%' }}
          />
        </Animated.View>
      </View>
    </Log>
  );
};

export default OnboardingScreen;
