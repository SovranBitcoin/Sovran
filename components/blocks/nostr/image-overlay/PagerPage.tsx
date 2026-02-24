/**
 * Single page in the image overlay pager.
 * Layout is driven by shared values so it updates when panel is dragged.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { Image } from 'expo-image';

function PagerPageAnimated({
  url,
  index,
  expandedWidthSv,
  expandedHeightSv,
}: {
  url: string;
  index: number;
  expandedWidthSv: SharedValue<number>;
  expandedHeightSv: SharedValue<number>;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    top: 0,
    left: index * expandedWidthSv.value,
    width: expandedWidthSv.value,
    height: expandedHeightSv.value,
  }));
  return (
    <Animated.View style={animatedStyle} pointerEvents="none">
      <Image
        source={{ uri: url }}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        cachePolicy="memory-disk"
      />
    </Animated.View>
  );
}

export const MemoizedPagerPage = React.memo(PagerPageAnimated);
