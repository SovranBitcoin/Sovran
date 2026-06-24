/**
 * ImageBlock: feed image thumbnail with tap-to-open overlay.
 * Registers layout on mount for shared-element close animation.
 * Applies blur to thumbnail when overlay is displaced.
 */

import React, { useRef, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import Reanimated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import { BlurView } from '@/shared/ui/primitives/BlurView';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import type { FeedEvent, NoteMetrics, ProfileInfo } from '../feedTypes';
import { useImageOverlay } from './provider';
import type { ImageOverlayPost, MediaType, ThumbnailLayout } from './types';
import { ANDROID_THUMB_DIM_MAX_OPACITY, THUMB_BLUR_MAX_INTENSITY } from './config';
import { Log, feedLog } from '@/shared/lib/logger';
import { useShiftLogger, useVisualLayoutLogger, urlHost } from '@/shared/lib/contentShiftLog';
import { getCachedAspect, rememberAspect } from './imageAspectCache';

/** Aspect ratio reserved before the image's intrinsic size is known. */
const DEFAULT_IMAGE_ASPECT = 16 / 9;

/** The subset of GestureResponderEvent.nativeEvent the calibration reads. */
type GestureTouchPoint = { pageX: number; pageY: number; locationX: number; locationY: number };

const AnimatedBlurView = Reanimated.createAnimatedComponent(BlurView);

/** Optional post payload for image overlay bottom panel (passed when opening from PostCard). */
interface ImageBlockOverlayPostProps {
  event: FeedEvent;
  metrics: NoteMetrics;
  profile?: ProfileInfo | null;
  reposted?: boolean;
  liked?: boolean;
  replied?: boolean;
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

export const ImageBlock = function ImageBlock({
  url,
  alt,
  allImageUrls,
  allMediaUrls,
  mediaTypes,
  mediaIndex,
  imageIndex,
  initialAspectRatio,
  onBeforeOpen,
  onPressIn,
  onPressOut,
  event: overlayEvent,
  metrics: overlayMetrics,
  profile: overlayProfile,
  reposted,
  liked,
  replied,
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
  /** NIP-92 imeta alt text, used as the image's accessibility label. */
  alt?: string;
  /**
   * Aspect ratio (width / height) known ahead of load — e.g. from the post's
   * NIP-92 imeta `dim`. Used as the initial reserved size so the image lays out
   * correctly on the first frame. A runtime cache of ratios learned from prior
   * `onLoad`s takes precedence (covers navigating in from an already-rendered
   * feed, where imeta may be absent).
   */
  initialAspectRatio?: number;
  /** When the post has multiple images, pass all urls so the overlay can show a pager. */
  allImageUrls?: string[];
  /** Index of this image among the post's images (for opening overlay at the correct page). */
  imageIndex?: number;
  /** When the post has mixed media (images + videos), pass all media urls and types for unified pager. */
  allMediaUrls?: string[];
  mediaTypes?: MediaType[];
  /** Index of this item in the combined media list (when using allMediaUrls). */
  mediaIndex?: number;
  /** Called just before opening overlay so feed can track source index (for swipe-up to next). */
  onBeforeOpen?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
} & Partial<ImageBlockOverlayPostProps>) {
  const [foreground] = useThemeColor(['foreground'] as const);
  // Seed the reserved size from what we already know (a ratio learned from a
  // prior onLoad, else the post's imeta dim) so the image doesn't flash 16:9 and
  // resize. Lazy initializer so the lookup runs once at mount.
  const [aspectRatio, setAspectRatio] = useState(
    () => getCachedAspect(url) ?? initialAspectRatio ?? DEFAULT_IMAGE_ASPECT
  );
  const [error, setError] = useState(false);
  const shift = useShiftLogger('ImageBlock');
  const containerRef = useRef<React.ComponentRef<typeof View>>(null);
  /** Ref to the actual image so we measure the image bounds for shared-element, not the container. */
  const imageRef = useRef<React.ComponentRef<typeof Image> | null>(null);
  const imageOverlay = useImageOverlay();
  const layoutIndex = mediaIndex ?? imageIndex ?? 0;
  const imageHost = urlHost(url);
  const visualLayout = useVisualLayoutLogger({
    scope: `feed.media.${overlayEvent?.id?.slice(0, 12) ?? imageHost}`,
    surface: 'feed',
    component: 'ImageBlock',
    itemKey: overlayEvent?.id ? `${overlayEvent.id}:${layoutIndex}` : `${imageHost}:${layoutIndex}`,
    itemType: mediaTypes?.[layoutIndex] ?? 'image',
    index: layoutIndex,
    extra: () => ({
      host: imageHost,
      aspectRatio: Math.round(aspectRatio * 100) / 100,
      overlayActive: imageOverlay?.activeUrl === url,
    }),
  });
  const setContainerRef = (node: React.ComponentRef<typeof View> | null) => {
    containerRef.current = node;
    visualLayout.ref(node);
  };

  type Measureable = {
    measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void;
  };
  const measureSourceRef = (): Measureable | null => {
    const imageNode = imageRef.current as Measureable | null;
    const containerNode = containerRef.current as Measureable | null;
    if (imageNode && typeof imageNode.measureInWindow === 'function') return imageNode;
    if (containerNode && typeof containerNode.measureInWindow === 'function') return containerNode;
    return null;
  };

  /**
   * measureInWindow + the provider's tap-calibrated measure-space correction.
   * On Android, RNS's contentOffset state (which is what makes Fabric's
   * measureInWindow include the native header / sheet displacement) can be
   * dropped, under-reporting pageY by exactly statusBar+toolbar — the
   * "dismiss lands too high" bug. EVERY rect that leaves this component goes
   * through here so tap-time, onLayout, and JIT-close rects share one space.
   */
  const correctionRef = imageOverlay?.measureSpaceCorrection;
  const measureCorrected = (
    node: Measureable,
    cb: (x: number, y: number, w: number, h: number) => void
  ) => {
    node.measureInWindow((pageX, pageY, width, height) => {
      const corr = correctionRef?.current;
      if (Platform.OS === 'android' && corr) {
        cb(pageX + corr.dx, pageY + corr.dy, width, height);
      } else {
        cb(pageX, pageY, width, height);
      }
    });
  };

  /**
   * Just-in-time re-measure for dismiss targeting. Recycled FlashList rows
   * never re-fire onLayout when size is unchanged, so the rect registered at
   * onLayout can be stale by close time; close() calls this to re-measure the
   * live node. Resolves null when the node is unmounted/unmeasurable.
   */
  const measureNow = (): Promise<ThumbnailLayout | null> => {
    return new Promise((resolve) => {
      const node = measureSourceRef();
      if (!node) {
        resolve(null);
        return;
      }
      measureCorrected(node, (pageX: number, pageY: number, width: number, height: number) => {
        if (!Number.isFinite(pageX) || !Number.isFinite(pageY) || !(width > 0) || !(height > 0)) {
          resolve(null);
          return;
        }
        resolve({ pageX, pageY, width, height });
      });
    });
  };

  const registerLayout = () => {
    const node = measureSourceRef();
    if (!node) return;
    measureCorrected(node, (pageX: number, pageY: number, width: number, height: number) => {
      imageOverlay?.registerThumbnailLayout(
        url,
        { pageX, pageY, width, height },
        overlayEvent?.id != null && layoutIndex != null
          ? { eventId: overlayEvent.id, imageIndex: layoutIndex, measureNow }
          : { measureNow }
      );
    });
  };

  const handlePress = (event?: { nativeEvent?: GestureTouchPoint }) => {
    if (!imageOverlay?.open) return;
    onBeforeOpen?.();
    const node = measureSourceRef();
    if (!node) return;
    // Capture the touch's native-truth coordinates synchronously: pageX/Y is
    // root-window space from the NATIVE view hierarchy (includes every
    // native-only displacement); locationX/Y is within the pressed view
    // (which shares the measured node's origin — the Pressable absolute-fills
    // the container, and the image fills the container). The difference
    // against measureInWindow's raw answer IS the systematic shadow-tree
    // error for this surface — ~statusBar+toolbar when RNS drops its
    // contentOffset state, ~0 when the pipeline works.
    const touch = event?.nativeEvent;
    const trueX = touch != null ? touch.pageX - touch.locationX : null;
    const trueY = touch != null ? touch.pageY - touch.locationY : null;
    node.measureInWindow((rawPageX: number, rawPageY: number, width: number, height: number) => {
      if (
        Platform.OS === 'android' &&
        correctionRef &&
        trueX != null &&
        trueY != null &&
        Number.isFinite(trueX) &&
        Number.isFinite(trueY)
      ) {
        const dx = trueX - rawPageX;
        const dy = trueY - rawPageY;
        // Sanity gates: x should match almost exactly; y can be off by up to
        // a native header (~120dp) or a sheet's top offset. Anything wilder
        // means locationX/Y was unreliable for this event — keep the last
        // good calibration instead.
        if (Math.abs(dx) <= 4 && dy >= -4 && dy <= 240) {
          if (Math.abs(correctionRef.current.dy - dy) > 1) {
            feedLog.debug('image_overlay.measure_correction', { dx, dy });
          }
          correctionRef.current = { dx: Math.abs(dx) <= 1 ? 0 : dx, dy };
        }
      }
      const corr = Platform.OS === 'android' && correctionRef ? correctionRef.current : null;
      const pageX = rawPageX + (corr?.dx ?? 0);
      const pageY = rawPageY + (corr?.dy ?? 0);
      // Tap-time registration so close() has a measureNow for this key even
      // when the row was recycled and onLayout never re-fired.
      imageOverlay.registerThumbnailLayout(
        url,
        { pageX, pageY, width, height },
        overlayEvent?.id != null
          ? { eventId: overlayEvent.id, imageIndex: layoutIndex, measureNow }
          : { measureNow }
      );
      const post: ImageOverlayPost | undefined =
        overlayEvent && overlayMetrics
          ? {
              event: {
                id: overlayEvent.id,
                kind: overlayEvent.kind,
                pubkey: overlayEvent.pubkey,
                content: overlayEvent.content,
                tags: overlayEvent.tags,
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
              replied,
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
      const urls =
        allMediaUrls && allMediaUrls.length > 0
          ? allMediaUrls
          : allImageUrls && allImageUrls.length > 1
            ? allImageUrls
            : undefined;
      imageOverlay.open({
        url,
        aspectRatio,
        pageX,
        pageY,
        width,
        height,
        urls: urls && urls.length > 1 ? urls : undefined,
        mediaTypes:
          mediaTypes && urls && mediaTypes.length === urls.length ? mediaTypes : undefined,
        initialIndex: mediaIndex ?? imageIndex ?? 0,
        post: post ?? null,
      });
    });
  };

  const fallbackBlur = useSharedValue(0);
  const thumbnailBlur = imageOverlay?.thumbnailBlurIntensity ?? fallbackBlur;
  const thumbnailBlurAnimatedProps = useAnimatedProps(() => ({
    intensity: thumbnailBlur.value,
  }));
  /**
   * Android: expo-blur without experimentalBlurMethod renders as a weak tint
   * while paying animatedProps cost every frame. Dim the thumbnail with a
   * plain animated-opacity scrim driven by the same displacement value
   * instead, preserving the intent (hide the duplicate thumbnail while the
   * overlay image is displaced; fade out as the dismiss morph lands on it).
   */
  const thumbnailDimStyle = useAnimatedStyle(() => ({
    opacity: (thumbnailBlur.value / THUMB_BLUR_MAX_INTENSITY) * ANDROID_THUMB_DIM_MAX_OPACITY,
  }));

  if (error) {
    return (
      <View
        accessible
        accessibilityLabel={alt ? `Image unavailable: ${alt}` : 'Image unavailable'}
        style={[styles.unavailable, { backgroundColor: opacity(foreground, 0.06) }]}>
        <Icon name="mdi:image-broken-variant" size={22} color={opacity(foreground, 0.4)} />
        <Text size={12} style={{ color: opacity(foreground, 0.4), marginTop: 4 }}>
          Image unavailable
        </Text>
      </View>
    );
  }

  const image = (
    <Image
      ref={imageRef}
      source={{ uri: url }}
      style={{ width: '100%', aspectRatio, borderRadius: 12 }}
      contentFit="cover"
      cachePolicy="disk"
      recyclingKey={url}
      transition={300}
      accessible={!!alt}
      accessibilityLabel={alt}
      accessibilityRole="image"
      onLoad={(e) => {
        const { width, height } = e.source;
        if (width && height) {
          const next = width / height;
          // Remember it so a later ImageBlock for this URL (e.g. the same post in
          // a thread) can reserve the right box up front instead of flashing.
          rememberAspect(url, next);
          // If we'd already reserved the right ratio (cache/imeta), this is a
          // no-op; otherwise the box resizes and shifts siblings — log the jump.
          shift.report('feed.shift.image.aspect', url, next, {
            host: urlHost(url),
            mediaIndex: layoutIndex,
            intrinsicWidth: width,
            intrinsicHeight: height,
            defaultAspect: DEFAULT_IMAGE_ASPECT,
          });
          setAspectRatio(next);
        }
      }}
      onError={() => {
        feedLog.info('feed.shift.image.error', {
          component: 'ImageBlock',
          host: imageHost,
          mediaIndex: layoutIndex,
          // The block collapses from its reserved aspect box to the fixed-height
          // "Image unavailable" placeholder — a downward shift of all siblings.
          fromAspect: Math.round(aspectRatio * 100) / 100,
        });
        setError(true);
      }}
    />
  );

  const isOverlayActive = imageOverlay?.activeUrl === url;
  return (
    <Log name="ImageBlock">
      <View style={styles.imageBlockOuter}>
        <View
          ref={setContainerRef}
          collapsable={false}
          style={{ aspectRatio }}
          onLayout={(event) => {
            registerLayout();
            visualLayout.onLayout(event);
          }}>
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
          {isOverlayActive &&
            (Platform.OS === 'android' ? (
              <Reanimated.View
                style={[StyleSheet.absoluteFill, styles.thumbnailDimAndroid, thumbnailDimStyle]}
                pointerEvents="none"
              />
            ) : (
              <AnimatedBlurView
                tint="dark"
                style={[StyleSheet.absoluteFill, { borderRadius: 12 }]}
                pointerEvents="none"
                animatedProps={thumbnailBlurAnimatedProps}
              />
            ))}
        </View>
      </View>
    </Log>
  );
};

const styles = StyleSheet.create({
  imageBlockOuter: {
    marginVertical: 6,
    borderRadius: 12,
    overflow: 'hidden',
  },
  unavailable: {
    marginVertical: 6,
    borderRadius: 12,
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailDimAndroid: {
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,1)',
  },
});
