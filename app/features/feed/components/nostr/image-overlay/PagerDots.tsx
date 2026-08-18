/**
 * Instagram-style pagination dots for multi-image pager.
 * Scale and opacity are driven by pagerOffsetSv for smooth page-change animation.
 */

import { StyleSheet, View } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import {
  DOTS_SIZE,
  DOTS_GAP,
  DOTS_SCALE_INPUT,
  DOTS_SCALE_OUTPUT,
  DOTS_OPACITY_INPUT,
  DOTS_OPACITY_OUTPUT,
} from './config';
import { Log } from '@/shared/lib/logger';

const DOT_CONTAINER_WIDTH = DOTS_SIZE + DOTS_GAP;

export function OverlayDot({
  index,
  pagerOffsetSv,
  activeColor,
}: {
  index: number;
  pagerOffsetSv: SharedValue<number>;
  activeColor: string;
}) {
  const animatedDotStyle = useAnimatedStyle(() => {
    const position = index - pagerOffsetSv.value;
    const scale = interpolate(
      position,
      [...DOTS_SCALE_INPUT],
      [...DOTS_SCALE_OUTPUT],
      Extrapolation.CLAMP
    );
    const opacity = interpolate(
      Math.abs(position),
      [...DOTS_OPACITY_INPUT],
      [...DOTS_OPACITY_OUTPUT],
      Extrapolation.CLAMP
    );
    return {
      transform: [{ scale }],
      opacity,
    };
  });

  return (
    <Log name="OverlayDot">
      <View style={styles.container}>
        <Animated.View style={[styles.dot, animatedDotStyle, { backgroundColor: activeColor }]} />
      </View>
    </Log>
  );
}

const styles = StyleSheet.create({
  container: {
    width: DOT_CONTAINER_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: DOTS_SIZE,
    height: DOTS_SIZE,
    borderRadius: DOTS_SIZE / 2,
  },
});
