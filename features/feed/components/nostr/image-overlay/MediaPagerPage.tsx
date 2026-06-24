/**
 * Single page in the image overlay pager: image or video.
 * Layout is driven by shared values so it updates when panel is dragged.
 * Video players are created lazily: only pages whose media is a video AND
 * that sit within the active page ±1 mount a player instance — image pages
 * and far video pages never call useVideoPlayer.
 */

import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { MediaType } from './types';
import { Log } from '@/shared/lib/logger';

/**
 * Inner video page: owns the player instance. Mounted only for near-active
 * video pages so far pages pay no player allocation; unmounting releases the
 * player via expo-video's hook lifecycle.
 */
function VideoPage({ url, isActive }: { url: string; isActive: boolean }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.muted = false;
  });

  useEffect(() => {
    try {
      if (isActive) {
        player.play();
      } else {
        player.pause();
      }
    } catch {
      // ignore
    }
  }, [isActive, player]);

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls={false}
      pointerEvents="none"
    />
  );
}

function MediaPageAnimated({
  url,
  mediaType,
  index,
  isActive,
  activeIndex,
  pagerIndex,
  expandedWidthSv,
  expandedHeightSv,
  containerWidthSv,
  containerHeightSv,
}: {
  url: string;
  mediaType: MediaType;
  index: number;
  isActive: boolean;
  /** Current pager index; video pages outside activeIndex ±1 render without a player instance. */
  activeIndex: number;
  /** This page's position in the pager when it differs from `index` (vertical feed renders each page at layout index 0). Defaults to `index`. */
  pagerIndex?: number;
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

  if (mediaType === 'video') {
    const isNearActive = Math.abs((pagerIndex ?? index) - activeIndex) <= 1;
    return (
      <Animated.View style={[animatedStyle]} pointerEvents="none" collapsable={false}>
        {/* Far video pages render the empty container only (no player, no
            poster fetch — an <Image> on a video url would download the file). */}
        {isNearActive ? <VideoPage url={url} isActive={isActive} /> : null}
      </Animated.View>
    );
  }

  return (
    <Log name="MediaPageAnimated">
      <Animated.View style={animatedStyle} pointerEvents="none">
        <Image
          source={{ uri: url, isAnimated: /\.(gif|webp)(\?.*)?$/i.test(url) }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          cachePolicy="disk"
        />
      </Animated.View>
    </Log>
  );
}

export const MemoizedMediaPagerPage = React.memo(MediaPageAnimated);
