/**
 * ImageBlock: feed image thumbnail with tap-to-open overlay.
 * Registers layout on mount for shared-element close animation.
 * Applies blur to thumbnail when overlay is displaced.
 *
 * Perf logs (__DEV__, [Image:Perf]):
 * - render count (per url), handlePress (tap to open overlay).
 */

import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Reanimated, { useAnimatedProps, useSharedValue } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { BlurView } from 'components/ui/BlurView';
import { View } from 'components/ui/View/View';
import type { FeedEvent, NoteMetrics, ProfileInfo } from '../shared';
import { useImageOverlay } from './provider';
import type { ImageOverlayPost } from './types';

const AnimatedBlurView = Reanimated.createAnimatedComponent(BlurView);

/** Optional post payload for image overlay bottom panel (passed when opening from PostCard). */
interface ImageBlockOverlayPostProps {
  event: FeedEvent;
  metrics: NoteMetrics;
  profile?: ProfileInfo | null;
  reposted?: boolean;
  liked?: boolean;
  repostPending?: boolean;
  likePending?: boolean;
  repostPendingDirection?: 'activating' | 'deactivating';
  likePendingDirection?: 'activating' | 'deactivating';
  onCommentPress?: () => void;
  onRepostPress?: () => void;
  onLikePress?: () => void;
  onActionPressIn?: () => void;
  onActionPressOut?: () => void;
}

export const ImageBlock = React.memo(function ImageBlock({
  url,
  allImageUrls,
  imageIndex,
  onPressIn,
  onPressOut,
  event: overlayEvent,
  metrics: overlayMetrics,
  profile: overlayProfile,
  reposted,
  liked,
  repostPending,
  likePending,
  repostPendingDirection,
  likePendingDirection,
  onCommentPress,
  onRepostPress,
  onLikePress,
  onActionPressIn,
  onActionPressOut,
}: {
  url: string;
  /** When the post has multiple images, pass all urls so the overlay can show a pager. */
  allImageUrls?: string[];
  /** Index of this image among the post's images (for opening overlay at the correct page). */
  imageIndex?: number;
  onPressIn?: () => void;
  onPressOut?: () => void;
} & Partial<ImageBlockOverlayPostProps>) {
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [error, setError] = useState(false);
  const containerRef = useRef<React.ComponentRef<typeof View>>(null);
  const imageOverlay = useImageOverlay();

  const registerLayout = useCallback(() => {
    containerRef.current?.measureInWindow(
      (pageX: number, pageY: number, width: number, height: number) => {
        imageOverlay?.registerThumbnailLayout?.(
          url,
          { pageX, pageY, width, height },
          overlayEvent?.id != null && imageIndex != null
            ? { eventId: overlayEvent.id, imageIndex }
            : undefined
        );
      }
    );
  }, [imageOverlay, url, overlayEvent?.id, imageIndex]);

  const handlePress = useCallback(() => {
    if (!imageOverlay?.open) return;
    containerRef.current?.measureInWindow(
      (pageX: number, pageY: number, width: number, height: number) => {
        const post: ImageOverlayPost | undefined =
          overlayEvent && overlayMetrics
            ? {
                event: {
                  id: overlayEvent.id,
                  pubkey: overlayEvent.pubkey,
                  content: overlayEvent.content,
                  created_at: overlayEvent.created_at,
                },
                metrics: {
                  replyCount: overlayMetrics.replyCount,
                  repostCount: overlayMetrics.repostCount,
                  likeCount: overlayMetrics.likeCount,
                  satsZapped: overlayMetrics.satsZapped,
                },
                profile: overlayProfile ?? null,
                reposted,
                liked,
                repostPending,
                likePending,
                repostPendingDirection,
                likePendingDirection,
                onCommentPress,
                onRepostPress,
                onLikePress,
                onActionPressIn,
                onActionPressOut,
              }
            : undefined;
        imageOverlay.open({
          url,
          aspectRatio,
          pageX,
          pageY,
          width,
          height,
          urls: allImageUrls && allImageUrls.length > 1 ? allImageUrls : undefined,
          initialIndex: imageIndex,
          post: post ?? null,
        });
      }
    );
  }, [
    imageOverlay,
    url,
    aspectRatio,
    allImageUrls,
    imageIndex,
    overlayEvent,
    overlayMetrics,
    overlayProfile,
    reposted,
    liked,
    repostPending,
    likePending,
    repostPendingDirection,
    likePendingDirection,
    onCommentPress,
    onRepostPress,
    onLikePress,
    onActionPressIn,
    onActionPressOut,
  ]);

  const fallbackBlur = useSharedValue(0);
  const thumbnailBlur = imageOverlay?.thumbnailBlurIntensity ?? fallbackBlur;
  const thumbnailBlurAnimatedProps = useAnimatedProps(() => ({
    intensity: thumbnailBlur.value,
  }));

  if (error) return null;

  const image = (
    <Image
      source={{ uri: url }}
      style={{ width: '100%', aspectRatio, borderRadius: 12 }}
      contentFit="cover"
      cachePolicy="memory-disk"
      recyclingKey={url}
      transition={300}
      onLoad={(e) => {
        const { width, height } = e.source;
        if (width && height) setAspectRatio(width / height);
      }}
      onError={() => setError(true)}
    />
  );

  const isOverlayActive = imageOverlay?.activeUrl === url;
  return (
    <View style={styles.imageBlockOuter}>
      <View
        ref={containerRef}
        collapsable={false}
        style={{ aspectRatio }}
        onLayout={registerLayout}>
        {imageOverlay?.open ? (
          <Pressable
            onPressIn={onPressIn}
            onPressOut={onPressOut}
            onPress={handlePress}
            style={StyleSheet.absoluteFill}>
            {image}
          </Pressable>
        ) : (
          image
        )}
        {isOverlayActive && (
          <AnimatedBlurView
            tint="dark"
            style={[StyleSheet.absoluteFill, { borderRadius: 12 }]}
            pointerEvents="none"
            animatedProps={thumbnailBlurAnimatedProps}
          />
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  imageBlockOuter: {
    marginVertical: 6,
    borderRadius: 12,
    overflow: 'hidden',
  },
});
