import { useEffect, useRef, useState } from 'react';
import {
  View,
  useWindowDimensions,
  type ScrollView,
  type TextLayoutEventData,
  type NativeSyntheticEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  LinearTransition,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';

import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { ScrollEdgeFade } from '@/shared/ui/composed/ScrollEdgeFade';
import { easeGradient } from '@/shared/lib/easeGradient';
import {
  BOTTOM_PANEL_PADDING_BOTTOM_EXTRA,
  BOTTOM_PANEL_PADDING_HORIZONTAL,
  BOTTOM_PANEL_PADDING_TOP,
  BOTTOM_PANEL_SAFE_HEIGHT,
  BOTTOM_PANEL_STIFF_DURATION_MS,
  DISMISS_ACTIVE_OFFSET_Y,
  DISMISS_FLICK_MIN_DISTANCE,
  DISMISS_FLICK_VELOCITY_PX_S,
  DISMISS_THRESHOLD_FRACTION,
  DISMISS_VELOCITY_WEIGHT_S,
} from '../image-overlay/config';
import { computeDismissDecision } from '../image-overlay/dismissDecision';

const CaptionGradient = withUniwind(LinearGradient);
const BOTTOM_GRADIENT = easeGradient({
  colorStops: {
    0: { color: 'rgba(0,0,0,0.0)' },
    1: { color: 'rgba(0,0,0,0.4)' },
  },
});

type Props = {
  caption: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
};

export function StoryCaption({ caption, expanded, onExpandedChange }: Props) {
  const { height: screenHeight } = useWindowDimensions();
  const { bottom } = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [measurement, setMeasurement] = useState({ full: 0, collapsed: 0, truncated: false });
  const scrollY = useSharedValue(0);
  const scrollRef = useRef<ScrollView>(null);
  const dragStartedAtTop = useSharedValue(false);
  useEffect(() => {
    if (!expanded) {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      scrollY.set(0);
    }
  }, [expanded, scrollY]);
  const duration = reducedMotion ? 0 : BOTTOM_PANEL_STIFF_DURATION_MS;
  const canToggle = expanded || measurement.truncated;
  const panelHeight = expanded
    ? Math.min(measurement.full, screenHeight * 0.45)
    : measurement.collapsed;
  const animatedHeight = useAnimatedStyle(() => ({
    height: panelHeight > 0 ? withTiming(panelHeight, { duration }) : undefined,
  }));
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });
  const collapse = () => onExpandedChange(false);
  const nativeScroll = Gesture.Native();
  const dismiss = Gesture.Pan()
    .enabled(expanded)
    .activeOffsetY(DISMISS_ACTIVE_OFFSET_Y)
    .failOffsetY(-DISMISS_ACTIVE_OFFSET_Y)
    .failOffsetX([-DISMISS_ACTIVE_OFFSET_Y, DISMISS_ACTIVE_OFFSET_Y])
    .simultaneousWithExternalGesture(nativeScroll)
    .onBegin(() => {
      dragStartedAtTop.set(scrollY.get() <= 0);
    })
    .onEnd((event) => {
      if (!dragStartedAtTop.get() || event.translationY <= 0) return;
      if (
        computeDismissDecision({
          dx: 0,
          dy: event.translationY,
          vx: 0,
          vy: event.velocityY,
          threshold: panelHeight * DISMISS_THRESHOLD_FRACTION,
          minFlickDistance: DISMISS_FLICK_MIN_DISTANCE,
          velocityWeightS: DISMISS_VELOCITY_WEIGHT_S,
          flickVelocityPxS: DISMISS_FLICK_VELOCITY_PX_S,
        }) === 'dismiss'
      ) {
        runOnJS(collapse)();
      }
    });

  const measureText = ({ nativeEvent: { lines } }: NativeSyntheticEvent<TextLayoutEventData>) => {
    const last = lines.at(-1);
    const collapsedLast = lines[Math.min(2, lines.length - 1)];
    setMeasurement({
      full: last ? last.y + last.height : 0,
      collapsed: collapsedLast ? collapsedLast.y + collapsedLast.height : 0,
      truncated: lines.length > 3,
    });
  };
  // Shared image-panel geometry plus this viewport's safe area is the sole inset owner.
  const panelPadding = {
    paddingHorizontal: BOTTOM_PANEL_PADDING_HORIZONTAL,
    paddingTop: BOTTOM_PANEL_PADDING_TOP,
    paddingBottom: bottom + BOTTOM_PANEL_PADDING_BOTTOM_EXTRA,
  };
  const gradientHeight = {
    height: Math.max(
      BOTTOM_PANEL_SAFE_HEIGHT,
      panelHeight + panelPadding.paddingBottom + panelPadding.paddingTop
    ),
  };

  return (
    <View className="absolute inset-x-0 bottom-0" pointerEvents="box-none">
      <CaptionGradient
        pointerEvents="none"
        className="absolute inset-x-0 bottom-0"
        colors={BOTTOM_GRADIENT.colors}
        locations={BOTTOM_GRADIENT.locations}
        style={gradientHeight}
      />
      <Animated.View
        pointerEvents="box-none"
        style={panelPadding}
        layout={LinearTransition.duration(duration)}>
        <View pointerEvents="box-none">
          {/* Measure without a line limit: iOS can report only the visible lines on truncated Text. */}
          <Text
            size={15}
            className="absolute inset-x-0 top-0 opacity-0"
            pointerEvents="none"
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onTextLayout={measureText}>
            {caption}
          </Text>
          <GestureDetector gesture={dismiss}>
            <Animated.View className="overflow-hidden" style={animatedHeight}>
              <GestureDetector gesture={nativeScroll}>
                <Animated.ScrollView
                  ref={scrollRef}
                  testID="story-caption-scroll"
                  scrollEnabled={expanded}
                  bounces={false}
                  onScroll={onScroll}
                  scrollEventThrottle={16}
                  showsVerticalScrollIndicator={false}>
                  <Pressable
                    testID="story-caption"
                    accessibilityRole={canToggle ? 'button' : 'text'}
                    accessibilityLabel={caption}
                    accessibilityHint={
                      canToggle ? (expanded ? 'Collapse caption' : 'Expand caption') : undefined
                    }
                    accessibilityState={{ expanded }}
                    onPress={canToggle ? () => onExpandedChange(!expanded) : undefined}>
                    <Text size={15} color="white" numberOfLines={expanded ? undefined : 3}>
                      {caption}
                    </Text>
                  </Pressable>
                </Animated.ScrollView>
              </GestureDetector>
              {expanded && (
                <ScrollEdgeFade edge="top" height={BOTTOM_PANEL_PADDING_TOP} color="black" />
              )}
            </Animated.View>
          </GestureDetector>
        </View>
        {!expanded && measurement.truncated && (
          <Pressable
            testID="story-caption-more"
            accessibilityRole="button"
            accessibilityLabel="Expand caption"
            accessibilityState={{ expanded: false }}
            className="self-start py-2"
            hitSlop={8}
            onPress={() => onExpandedChange(true)}>
            <Text size={15} color="white" bold>
              more
            </Text>
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}
