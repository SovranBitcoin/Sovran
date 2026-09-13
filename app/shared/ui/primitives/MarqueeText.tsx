import React, { useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useVisualActivityEffect } from '@/shared/hooks/useVisualActivityEffect';
import { computeMarqueeAnimation } from '@/shared/lib/marquee';
import { Text } from './Text';

type MarqueeTextProps = Pick<React.ComponentProps<typeof Text>, 'style' | 'size' | 'weight'> & {
  text: string;
  speedPxPerSecond?: number;
  delayMs?: number;
  gapPx?: number;
  active?: boolean;
  testID?: string;
  accessibilityLabel?: string;
};

export function MarqueeText({
  text,
  speedPxPerSecond = 30,
  delayMs = 1500,
  gapPx = 48,
  active = true,
  testID,
  accessibilityLabel = text,
  ...textProps
}: MarqueeTextProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [measurement, setMeasurement] = useState({ text: '', width: 0, fontScale: 0 });
  const { fontScale } = useWindowDimensions();
  const textWidth =
    measurement.text === text && measurement.fontScale === fontScale ? measurement.width : 0;
  const gap = Math.max(0, gapPx);
  const { overflowing, distancePx, durationMs } = computeMarqueeAnimation({
    textWidth,
    containerWidth,
    speedPxPerSecond,
    gapPx: gap,
  });
  const reducedMotion = useReducedMotion();
  const translateX = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  useVisualActivityEffect(
    () => {
      translateX.value = 0;
      translateX.value = withRepeat(
        withSequence(
          withDelay(
            delayMs,
            withTiming(-distancePx, { duration: durationMs, easing: Easing.linear })
          ),
          withTiming(0, { duration: 0 })
        ),
        -1
      );
      return () => cancelAnimation(translateX);
    },
    active && overflowing && !reducedMotion
  );

  const trackStyle = { width: textWidth * 2 + gap, gap };
  const copyStyle = [textProps.style, { width: textWidth }];

  return (
    <View
      className="w-full overflow-hidden"
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}>
      {/* A horizontal viewport gives the measuring text unconstrained width. */}
      <ScrollView
        key={`${text}:${fontScale}`}
        horizontal
        scrollEnabled={false}
        className="absolute opacity-0"
        pointerEvents="none"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <Text
          {...textProps}
          numberOfLines={1}
          onLayout={(event) =>
            setMeasurement({ text, fontScale, width: event.nativeEvent.layout.width })
          }>
          {text}
        </Text>
      </ScrollView>
      {overflowing && !reducedMotion ? (
        <Animated.View className="flex-row" style={[trackStyle, animatedStyle]}>
          <Text {...textProps} style={copyStyle} numberOfLines={1} accessible={false}>
            {text}
          </Text>
          <Text
            {...textProps}
            style={copyStyle}
            numberOfLines={1}
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants">
            {text}
          </Text>
        </Animated.View>
      ) : (
        <Text {...textProps} numberOfLines={1} accessible={false}>
          {text}
        </Text>
      )}
    </View>
  );
}
