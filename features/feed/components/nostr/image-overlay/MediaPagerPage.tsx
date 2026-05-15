/**
 * Single page in the image overlay pager: image or video.
 * Layout is driven by shared values so it updates when panel is dragged.
 */

import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { MediaType } from './types';
import { Log } from '@/shared/lib/logger';

function MediaPageAnimated({
  url,
  mediaType,
  index,
  isActive,
  expandedWidthSv,
  expandedHeightSv,
  containerWidthSv,
  containerHeightSv,
}: {
  url: string;
  mediaType: MediaType;
  index: number;
  isActive: boolean;
  expandedWidthSv: SharedValue<number>;
  expandedHeightSv: SharedValue<number>;
  /** When set (e.g. single-media dismiss), size the view to the container so it shrinks with the animation instead of relying on scale transform. */
  containerWidthSv?: SharedValue<number>;
  containerHeightSv?: SharedValue<number>;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const w =
      containerWidthSv != null && containerHeightSv != null
        ? containerWidthSv.value
        : expandedWidthSv.value;
    const h =
      containerWidthSv != null && containerHeightSv != null
        ? containerHeightSv.value
        : expandedHeightSv.value;
    return {
      position: 'absolute' as const,
      top: 0,
      left: index * (containerWidthSv != null ? w : expandedWidthSv.value),
      width: w,
      height: h,
    };
  });

  const player = useVideoPlayer(mediaType === 'video' ? url : '', (p) => {
    p.loop = true;
    p.muted = false;
  });

  useEffect(() => {
    if (mediaType !== 'video') return;
    try {
      if (isActive) {
        player.play();
      } else {
        player.pause();
      }
    } catch {
      // ignore
    }
  }, [mediaType, isActive, player]);

  if (mediaType === 'video') {
    return (
      <Animated.View style={[animatedStyle]} pointerEvents="none" collapsable={false}>
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          nativeControls={false}
          pointerEvents="none"
        />
      </Animated.View>
    );
  }

  return (
    <Log name="MediaPageAnimated">
      <Animated.View style={animatedStyle} pointerEvents="none">
        <Image
          source={{ uri: url }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          cachePolicy="disk"
        />
      </Animated.View>
    </Log>
  );
}

export const MemoizedMediaPagerPage = React.memo(MediaPageAnimated);
