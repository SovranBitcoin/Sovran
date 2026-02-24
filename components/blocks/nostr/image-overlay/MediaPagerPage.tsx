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

function MediaPageAnimated({
  url,
  mediaType,
  index,
  isActive,
  expandedWidthSv,
  expandedHeightSv,
}: {
  url: string;
  mediaType: MediaType;
  index: number;
  isActive: boolean;
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

  const player = useVideoPlayer(mediaType === 'video' ? url : '', (p) => {
    p.loop = true;
    p.muted = true;
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
      <Animated.View style={animatedStyle} pointerEvents="none" collapsable={false}>
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

export const MemoizedMediaPagerPage = React.memo(MediaPageAnimated);
