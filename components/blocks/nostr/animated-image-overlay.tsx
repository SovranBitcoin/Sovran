/**
 * Fullscreen image overlay with blur, pan-to-dismiss, and tap-to-close.
 * Renders only when ImageOverlayProvider is present and activeUrl is set.
 *
 * Performance logging (__DEV__ only, filter by [Image:Perf]):
 * - mount/unmount, render count (re-renders)
 * - pan gesture: onStart, onFinalize (distance, threshold, dismissed)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import {
  type GestureType,
  Gesture,
  GestureDetector,
  ScrollView as GHScrollView,
} from 'react-native-gesture-handler';
import { FullWindowOverlay } from 'react-native-screens';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Icon from 'assets/icons';
import { Text } from 'components/ui/Text';
import { Avatar } from 'components/ui/Avatar';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { formatTimestamp, formatCount, formatSats, parseContent } from './shared';
import type { ContentSegment } from './shared';
import type { ImageOverlayContextValue, ImageOverlayPost } from './image-overlay-provider';
import { IMAGE_OVERLAY_TIMING_CONFIG, useImageOverlay } from './image-overlay-provider';
import {
  DISMISS_ACTIVE_OFFSET_Y,
  DISMISS_BLUR_AT_REST,
  DISMISS_CLOSE_BTN_FADE_DURATION_MS,
  DISMISS_DRAG_FOLLOW,
  DISMISS_DRAG_RANGE_FRACTION,
  DISMISS_FAIL_OFFSET_X,
  DISMISS_MIN_DISTANCE,
  DISMISS_SCALE_AT_DRAG,
  DISMISS_THRESHOLD_FRACTION,
  DOTS_ACTIVE_COLOR,
  DOTS_GAP,
  DOTS_OPACITY_INPUT,
  DOTS_OPACITY_OUTPUT,
  DOTS_SCALE_INPUT,
  DOTS_SCALE_OUTPUT,
  DOTS_SIZE,
  IMAGE_WRAP_BORDER_RADIUS,
  PAGER_ACTIVE_OFFSET_X,
  PAGER_FAIL_OFFSET_Y,
  PAGER_FLICK_VELOCITY_THRESHOLD,
  PAGER_MIN_DISTANCE,
  PAGER_VELOCITY_CLAMP,
  PAGER_VELOCITY_WEIGHT,
  SNAP_SPRING_PAGE_CHANGE,
  SNAP_SPRING_SAME_PAGE,
  CLOSE_BUTTON_BG,
  CLOSE_BUTTON_LEFT,
  CLOSE_BUTTON_PADDING,
  CLOSE_BUTTON_TOP_OFFSET,
  DOT_PAGER_BOTTOM,
  BOTTOM_PANEL_ABSOLUTE_OVERLAY_HEIGHT,
  BOTTOM_PANEL_MAX_HEIGHT_FRACTION,
  BOTTOM_PANEL_MAX_HEIGHT_INSET_PX,
  BOTTOM_PANEL_SAFE_HEIGHT,
  BOTTOM_PANEL_SHEET_SNAP_60_FRACTION,
  BOTTOM_PANEL_STIFF_DURATION_MS,
  BOTTOM_PANEL_PADDING_BOTTOM_EXTRA,
  BOTTOM_PANEL_PADDING_TOP,
  BOTTOM_PANEL_PADDING_HORIZONTAL,
} from './image-overlay.config';

function logImageVerbose(tag: string, payload: Record<string, unknown>) {
  if (__DEV__) console.log(`[Image:Verbose] ${tag}`, payload);
}

function logPerfOverlayMount() {
  if (__DEV__) console.log('[Image:Perf] AnimatedImageOverlayContent mounted');
}
function logPerfOverlayUnmount() {
  if (__DEV__) console.log('[Image:Perf] AnimatedImageOverlayContent unmounted');
}
function logPerfOverlayRender(renderCount: number) {
  if (__DEV__) console.log('[Image:Perf] AnimatedImageOverlayContent render #', renderCount);
}
function logPerfPanStart() {
  if (__DEV__) console.log('[Image:Perf] pan onStart');
}
function logPerfPanFinalize(distance: number, threshold: number, dismissed: boolean) {
  if (__DEV__) {
    console.log('[Image:Perf] pan onFinalize', {
      distance: Math.round(distance),
      threshold: Math.round(threshold),
      dismissed,
    });
  }
}

function logImageVerbosePanStart(
  panStartX: number,
  panStartY: number,
  imageX: number,
  imageY: number,
  imageW: number,
  imageH: number
) {
  if (__DEV__) {
    logImageVerbose('dismiss pan onStart', {
      panStartPosition: { x: panStartX, y: panStartY },
      overlayRect_current: { x: imageX, y: imageY, w: imageW, h: imageH },
      imageCenter: { x: imageX + imageW / 2, y: imageY + imageH / 2 },
    });
  }
}

function logImageVerbosePanFinalize(
  deltaX: number,
  deltaY: number,
  distance: number,
  ew: number,
  eh: number,
  threshold: number,
  dismissed: boolean,
  translationX: number,
  translationY: number
) {
  if (__DEV__) {
    logImageVerbose('dismiss pan onFinalize', {
      delta: { x: deltaX, y: deltaY },
      distance,
      viewportSize: { w: ew, h: eh },
      thresholdFormula: `max(ew, eh) * DISMISS_THRESHOLD_FRACTION`,
      threshold,
      dismissed,
      translation: { x: translationX, y: translationY },
      action: dismissed ? 'close()' : 'openToCenter()',
    });
  }
}

// Gesture debug logs (filter by [Image:Gesture])
function logDismissPanStart() {
  if (__DEV__) console.log('[Image:Gesture] DISMISS pan onStart (vertical drag-to-dismiss)');
}
function logDismissPanFinalize(
  tx: number,
  ty: number,
  distance: number,
  threshold: number,
  dismissed: boolean
) {
  if (__DEV__) {
    console.log('[Image:Gesture] DISMISS pan onFinalize', {
      translationX: Math.round(tx),
      translationY: Math.round(ty),
      distance: Math.round(distance),
      threshold: Math.round(threshold),
      dismissed,
      action: dismissed ? 'CLOSING overlay' : 'snapping back to center',
    });
  }
}
function logPagerPanStart() {
  if (__DEV__) console.log('[Image:Gesture] PAGER pan onStart (horizontal page swipe)');
}
function logPagerPanEnd(
  tx: number,
  velocityX: number,
  snapTo: number,
  startIndex: number,
  didChangePage: boolean
) {
  if (__DEV__) {
    console.log('[Image:Gesture] PAGER pan onEnd', {
      translationX: Math.round(tx),
      velocityX: Math.round(velocityX),
      snapTo,
      startIndex,
      didChangePage,
      action: didChangePage ? 'CHANGING page' : 'staying on same page',
    });
  }
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

/** Pager page with layout driven by shared values so it updates when panel is dragged. */
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

const MemoizedPagerPageAnimated = React.memo(PagerPageAnimated);

const DOT_CONTAINER_WIDTH = DOTS_SIZE + DOTS_GAP;

function OverlayDot({
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
    <View style={overlayDotStyles.container}>
      <Animated.View
        style={[overlayDotStyles.dot, animatedDotStyle, { backgroundColor: activeColor }]}
      />
    </View>
  );
}

const overlayDotStyles = StyleSheet.create({
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

const PANEL_BG = 'rgba(0,0,0,0.82)';
const PANEL_TEXT = 'rgba(255,255,255,0.95)';
const PANEL_TEXT_MUTED = 'rgba(255,255,255,0.6)';
const LIKED_COLOR = '#ff5a7a';
const REPOSTED_COLOR = '#4cd964';

const PANEL_CONTENT_TRUNCATE_LIMIT = 120;
const PANEL_INLINE_IMAGE_MAX_HEIGHT = 200;

type PanelBlock = { type: 'text'; value: string } | { type: 'image'; url: string };

/** Build ordered blocks (text + image) from parsed segments for overlay panel. */
function segmentsToBlocks(segments: ContentSegment[]): PanelBlock[] {
  const blocks: PanelBlock[] = [];
  let textAcc = '';
  for (const seg of segments) {
    if (seg.kind === 'text') {
      textAcc += seg.text;
    } else if (seg.kind === 'newline') {
      textAcc += '\n';
    } else if (seg.kind === 'url') {
      textAcc += seg.url;
    } else if (seg.kind === 'hashtag') {
      textAcc += `#${seg.tag}`;
    } else if (seg.kind === 'image') {
      if (textAcc.length > 0) {
        blocks.push({ type: 'text', value: textAcc });
        textAcc = '';
      }
      blocks.push({ type: 'image', url: seg.url });
    }
  }
  if (textAcc.length > 0) blocks.push({ type: 'text', value: textAcc });
  return blocks;
}

/** Fallback background for inline image area before load or if blur unavailable. */
const PANEL_INLINE_IMAGE_BG = 'rgba(40, 40, 48, 0.95)';

/** Renders an image full width at original aspect ratio, capped by max height; letterbox areas show a blurred cover of the same image. */
function InlinePanelImage({ uri }: { uri: string }) {
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [layoutWidth, setLayoutWidth] = useState<number>(0);
  const onLoad = useCallback((e: { source: { width: number; height: number } }) => {
    const { width, height } = e.source;
    if (!width || !height) return;
    setNaturalSize({ w: width, h: height });
  }, []);
  const onLayout = useCallback((e: { nativeEvent: { layout: { width: number } } }) => {
    setLayoutWidth(e.nativeEvent.layout.width);
  }, []);
  const { boxHeight, imageStyle } = useMemo(() => {
    const placeholderHeight = 120;
    if (!layoutWidth) {
      return {
        boxHeight: placeholderHeight,
        imageStyle: {
          width: '100%' as const,
          height: placeholderHeight,
          borderRadius: 8,
          backgroundColor: PANEL_INLINE_IMAGE_BG,
        },
      };
    }
    if (!naturalSize) {
      const h = Math.min(placeholderHeight, PANEL_INLINE_IMAGE_MAX_HEIGHT);
      return {
        boxHeight: h,
        imageStyle: {
          width: layoutWidth,
          height: h,
          borderRadius: 8,
          backgroundColor: PANEL_INLINE_IMAGE_BG,
        },
      };
    }
    const { w, h } = naturalSize;
    const height = Math.min((layoutWidth * h) / w, PANEL_INLINE_IMAGE_MAX_HEIGHT);
    const boxHeight = Math.round(height);
    return {
      boxHeight,
      imageStyle: {
        width: layoutWidth,
        height: boxHeight,
        borderRadius: 8,
      },
    };
  }, [layoutWidth, naturalSize]);

  const showBlurredLetterbox = layoutWidth > 0 && naturalSize !== null;

  return (
    <View
      style={[
        bottomPanelStyles.inlineImageWrap,
        { backgroundColor: PANEL_INLINE_IMAGE_BG, width: layoutWidth || '100%', height: boxHeight },
      ]}
      onLayout={onLayout}
      pointerEvents="none">
      {showBlurredLetterbox ? (
        <>
          <Image
            source={{ uri }}
            style={[StyleSheet.absoluteFill, { borderRadius: 8 }]}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
          <BlurView style={StyleSheet.absoluteFill} tint="dark" intensity={80} />
          <Image
            source={{ uri }}
            style={imageStyle}
            contentFit="contain"
            cachePolicy="memory-disk"
            onLoad={onLoad}
          />
        </>
      ) : (
        <Image
          source={{ uri }}
          style={imageStyle}
          contentFit="contain"
          cachePolicy="memory-disk"
          onLoad={onLoad}
        />
      )}
    </View>
  );
}

/** Scrollable part of the bottom panel: author, note content (with show more), metrics. */
const ImageOverlayBottomPanelContent = React.memo(function ImageOverlayBottomPanelContent({
  post,
}: {
  post: ImageOverlayPost;
}) {
  const [contentExpanded, setContentExpanded] = useState(false);
  const { event, metrics, profile, reposted, liked, onRepostPress, onLikePress } = post;
  const displayName = profile?.name ?? `${event.pubkey.slice(0, 8)}…`;
  const shortTime = formatTimestamp(event.created_at);
  const fullContent = event.content.trim();

  const { blocks } = useMemo(() => {
    const allSegments = parseContent(fullContent);
    const allBlocks = segmentsToBlocks(allSegments);
    if (fullContent.length <= PANEL_CONTENT_TRUNCATE_LIMIT || contentExpanded) {
      return { blocks: allBlocks };
    }
    let count = 0;
    const out: PanelBlock[] = [];
    for (const block of allBlocks) {
      if (block.type === 'text') {
        if (count + block.value.length > PANEL_CONTENT_TRUNCATE_LIMIT) {
          const take = PANEL_CONTENT_TRUNCATE_LIMIT - count;
          out.push({ type: 'text', value: block.value.slice(0, take) + '…' });
          return { blocks: out };
        }
        out.push(block);
        count += block.value.length;
      } else {
        out.push(block);
      }
    }
    return { blocks: out };
  }, [fullContent, contentExpanded]);

  const hasContent = fullContent.length > 0;
  const canExpand = fullContent.length > PANEL_CONTENT_TRUNCATE_LIMIT;
  const showMoreVisible = canExpand && !contentExpanded;
  const showLessVisible = canExpand && contentExpanded;

  return (
    <View style={bottomPanelStyles.wrap}>
      {/* Author row */}
      <Pressable
        onPress={() => {
          router.push({
            pathname: '/(user-flow)/profile' as any,
            params: { pubkey: event.pubkey },
          });
        }}
        style={bottomPanelStyles.authorRow}>
        <Avatar
          picture={profile?.picture}
          seed={event.pubkey}
          size={32}
          variant="person"
          name={displayName}
        />
        <View style={bottomPanelStyles.authorTextWrap}>
          <Text bold size={14} style={{ color: PANEL_TEXT }} numberOfLines={1}>
            {displayName}
          </Text>
          <Text size={13} style={{ color: PANEL_TEXT_MUTED }}>
            {shortTime}
          </Text>
        </View>
      </Pressable>
      {/* Post content with inline image blocks (non-clickable) and show more */}
      {hasContent ? (
        <View>
          {blocks.map((block, i) =>
            block.type === 'text' ? (
              <Text
                key={i}
                size={14}
                style={[bottomPanelStyles.contentText, { color: PANEL_TEXT_MUTED }]}
                numberOfLines={contentExpanded ? undefined : 2}>
                {block.value}
              </Text>
            ) : (
              <InlinePanelImage key={i} uri={block.url} />
            )
          )}
          {showMoreVisible && (
            <Text
              size={14}
              style={[bottomPanelStyles.contentText, { color: PANEL_TEXT_MUTED, marginTop: 4 }]}
              onPress={() => setContentExpanded((e) => !e)}>
              show more
            </Text>
          )}
          {showLessVisible && (
            <Text
              size={14}
              style={[bottomPanelStyles.contentText, { color: PANEL_TEXT_MUTED, marginTop: 4 }]}
              onPress={() => setContentExpanded((e) => !e)}>
              show less
            </Text>
          )}
        </View>
      ) : null}
      {/* Stats / actions row — comment is display-only in overlay (no thread modal) */}
      <View style={bottomPanelStyles.metricsRow}>
        <View style={bottomPanelStyles.metricBtn}>
          <Icon name="iconamoon:comment-fill" size={16} color={PANEL_TEXT_MUTED} />
          <Text size={13} style={{ color: PANEL_TEXT_MUTED }}>
            {formatCount(metrics.replyCount)}
          </Text>
        </View>
        <Pressable
          onPress={onRepostPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={bottomPanelStyles.metricBtn}>
          <Icon
            name="garden:arrow-retweet-fill-16"
            size={17}
            color={reposted ? REPOSTED_COLOR : PANEL_TEXT_MUTED}
          />
          <Text size={13} style={{ color: reposted ? REPOSTED_COLOR : PANEL_TEXT_MUTED }}>
            {formatCount(metrics.repostCount)}
          </Text>
        </Pressable>
        <Pressable
          onPress={onLikePress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={bottomPanelStyles.metricBtn}>
          <Icon
            name="iconamoon:heart-fill"
            size={16}
            color={liked ? LIKED_COLOR : PANEL_TEXT_MUTED}
          />
          <Text size={13} style={{ color: liked ? LIKED_COLOR : PANEL_TEXT_MUTED }}>
            {formatCount(metrics.likeCount)}
          </Text>
        </Pressable>
        <View style={bottomPanelStyles.metricBtn}>
          <Icon name="mingcute:lightning-fill" size={16} color={PANEL_TEXT_MUTED} />
          <Text size={13} style={{ color: PANEL_TEXT_MUTED }}>
            {metrics.satsZapped > 0 ? formatSats(metrics.satsZapped) : '0'}
          </Text>
        </View>
      </View>
    </View>
  );
});

/** Fixed reply row shown at bottom of the sheet (does not scroll). */
const ImageOverlayBottomPanelReply = React.memo(function ImageOverlayBottomPanelReply({
  currentUserPubkey,
  onReplyPress,
}: {
  currentUserPubkey: string | null;
  onReplyPress: () => void;
}) {
  return (
    <Pressable onPress={onReplyPress} style={bottomPanelStyles.replyRow}>
      <Avatar seed={currentUserPubkey ?? ''} size={28} variant="person" name="" />
      <View style={bottomPanelStyles.replyInputWrap}>
        <Text size={14} style={{ color: PANEL_TEXT_MUTED }}>
          Post your reply
        </Text>
      </View>
    </Pressable>
  );
});

/** Absolute overlay bar when sheet is closed: pfp, truncated content, show more, metric buttons. Tapping comment or show more opens the sheet. */
const ImageOverlayAbsoluteBar = React.memo(function ImageOverlayAbsoluteBar({
  post,
  onOpenSheet,
}: {
  post: ImageOverlayPost;
  onOpenSheet: () => void;
}) {
  const { event, metrics, profile, reposted, liked, onRepostPress, onLikePress } = post;
  const displayName = profile?.name ?? `${event.pubkey.slice(0, 8)}…`;
  const shortTime = formatTimestamp(event.created_at);
  const fullContent = event.content.trim();
  const contentPreview = fullContent.slice(0, 120);
  const contentTruncated = fullContent.length > 120;

  const handleCommentPress = useCallback(() => {
    onOpenSheet();
  }, [onOpenSheet]);

  const handleShowMorePress = useCallback(() => {
    onOpenSheet();
  }, [onOpenSheet]);

  return (
    <View style={[bottomPanelStyles.wrap, absoluteBarStyles.bar]}>
      <Pressable
        onPress={() => {
          router.push({
            pathname: '/(user-flow)/profile' as any,
            params: { pubkey: event.pubkey },
          });
        }}
        style={bottomPanelStyles.authorRow}>
        <Avatar
          picture={profile?.picture}
          seed={event.pubkey}
          size={28}
          variant="person"
          name={displayName}
        />
        <View style={bottomPanelStyles.authorTextWrap}>
          <Text bold size={13} style={{ color: PANEL_TEXT }} numberOfLines={1}>
            {displayName}
          </Text>
          <Text size={12} style={{ color: PANEL_TEXT_MUTED }}>
            {shortTime}
          </Text>
        </View>
      </Pressable>
      {fullContent.length > 0 ? (
        <View style={absoluteBarStyles.contentRow}>
          <Text
            size={13}
            style={[bottomPanelStyles.contentText, { color: PANEL_TEXT_MUTED }]}
            numberOfLines={1}>
            {contentPreview}
            {contentTruncated ? '…' : ''}
          </Text>
          {contentTruncated && (
            <Text
              size={13}
              style={[bottomPanelStyles.contentText, absoluteBarStyles.showMore]}
              onPress={handleShowMorePress}>
              show more
            </Text>
          )}
        </View>
      ) : null}
      <View style={bottomPanelStyles.metricsRow}>
        <Pressable
          onPress={handleCommentPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={bottomPanelStyles.metricBtn}>
          <Icon name="iconamoon:comment-fill" size={16} color={PANEL_TEXT_MUTED} />
          <Text size={13} style={{ color: PANEL_TEXT_MUTED }}>
            {formatCount(metrics.replyCount)}
          </Text>
        </Pressable>
        <Pressable
          onPress={onRepostPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={bottomPanelStyles.metricBtn}>
          <Icon
            name="garden:arrow-retweet-fill-16"
            size={17}
            color={reposted ? REPOSTED_COLOR : PANEL_TEXT_MUTED}
          />
          <Text size={13} style={{ color: reposted ? REPOSTED_COLOR : PANEL_TEXT_MUTED }}>
            {formatCount(metrics.repostCount)}
          </Text>
        </Pressable>
        <Pressable
          onPress={onLikePress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={bottomPanelStyles.metricBtn}>
          <Icon
            name="iconamoon:heart-fill"
            size={16}
            color={liked ? LIKED_COLOR : PANEL_TEXT_MUTED}
          />
          <Text size={13} style={{ color: liked ? LIKED_COLOR : PANEL_TEXT_MUTED }}>
            {formatCount(metrics.likeCount)}
          </Text>
        </Pressable>
        <View style={bottomPanelStyles.metricBtn}>
          <Icon name="mingcute:lightning-fill" size={16} color={PANEL_TEXT_MUTED} />
          <Text size={13} style={{ color: PANEL_TEXT_MUTED }}>
            {metrics.satsZapped > 0 ? formatSats(metrics.satsZapped) : '0'}
          </Text>
        </View>
      </View>
    </View>
  );
});

const absoluteBarStyles = StyleSheet.create({
  bar: {
    paddingVertical: 10,
    paddingBottom: 12,
  },
  contentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
  },
  showMore: {
    marginTop: 0,
  },
});

const bottomPanelStyles = StyleSheet.create({
  wrap: {
    paddingHorizontal: BOTTOM_PANEL_PADDING_HORIZONTAL,
    paddingTop: BOTTOM_PANEL_PADDING_TOP,
    gap: 10,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  authorTextWrap: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
  contentText: {
    lineHeight: 20,
  },
  inlineImageWrap: {
    marginVertical: 6,
    borderRadius: 8,
    overflow: 'hidden',
    alignSelf: 'stretch',
    width: '100%',
    maxHeight: PANEL_INLINE_IMAGE_MAX_HEIGHT,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
  },
  metricBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  replyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 20,
  },
  replyInputWrap: {
    flex: 1,
    justifyContent: 'center',
  },
});

function AnimatedImageOverlayContent({ ctx }: { ctx: ImageOverlayContextValue }) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { keys: nostrKeys } = useNostrKeysContext();
  const renderCountRef = useRef(0);
  const panelMinHeightReportedRef = useRef(false);
  renderCountRef.current += 1;

  useEffect(() => {
    logPerfOverlayMount();
    return logPerfOverlayUnmount;
  }, []);

  useEffect(() => {
    if (__DEV__) logPerfOverlayRender(renderCountRef.current);
  });

  const imageScale = useSharedValue(1);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const dismissPanActive = useSharedValue(0);
  /** Toggle via tap on image: 1 = show close/panel/dots, 0 = hide to focus on image. */
  const overlayUIVisible = useSharedValue(1);
  /** Opacity for the absolute overlay bar (sheet closed); animated so it fades in/out instead of popping. */
  const absoluteOverlayOpacitySv = useSharedValue(0);

  const {
    activeUrl,
    activeUrls,
    activeIndex,
    setActiveIndex,
    activeOverlayPost,
    imageState,
    imageXCoord,
    imageYCoord,
    imageWidth,
    imageHeight,
    blurIntensity,
    closeBtnOpacity,
    expandedWidth,
    expandedHeight,
    expandedWidthSv,
    expandedHeightSv,
    panelHeightSv,
    setPanelContentMinHeight,
    close,
    openToCenter,
  } = ctx;

  const hasMultipleImages = activeUrls.length > 1;
  const maxPagerIndex = Math.max(0, activeUrls.length - 1);

  useEffect(() => {
    if (__DEV__ && hasMultipleImages) {
      console.log('[Image:Gesture] Config (multi-image)', {
        dismiss: {
          activeOffsetY: `[-${DISMISS_ACTIVE_OFFSET_Y}, ${DISMISS_ACTIVE_OFFSET_Y}] (dismiss activates after ${DISMISS_ACTIVE_OFFSET_Y}px vertical)`,
          failOffsetX: `[-${DISMISS_FAIL_OFFSET_X}, ${DISMISS_FAIL_OFFSET_X}] (dismiss fails if ${DISMISS_FAIL_OFFSET_X}px horizontal first)`,
        },
        pager: {
          activeOffsetX: `[-${PAGER_ACTIVE_OFFSET_X}, ${PAGER_ACTIVE_OFFSET_X}] (pager activates after ${PAGER_ACTIVE_OFFSET_X}px horizontal)`,
          failOffsetY: `[-${PAGER_FAIL_OFFSET_Y}, ${PAGER_FAIL_OFFSET_Y}] (pager fails if ${PAGER_FAIL_OFFSET_Y}px vertical first)`,
        },
        expected: 'Horizontal swipe → PAGER. Vertical swipe → DISMISS.',
      });
    }
  }, [hasMultipleImages]);

  const pagerOffsetSv = useSharedValue(activeIndex);
  const startPagerOffsetSv = useSharedValue(activeIndex);

  useEffect(() => {
    pagerOffsetSv.value = activeIndex;
  }, [activeIndex, pagerOffsetSv]);

  useEffect(() => {
    if (activeUrl) overlayUIVisible.value = 1;
  }, [activeUrl, overlayUIVisible]);

  useEffect(() => {
    if (__DEV__ && activeUrl) {
      logImageVerbose('overlay visible context snapshot', {
        activeUrlShort: activeUrl.slice(0, 40),
        activeIndex,
        activeUrlsCount: activeUrls.length,
        hasPanel: !!activeOverlayPost,
        expandedWidth,
        expandedHeight,
        screenWidth,
        screenHeight,
        viewportAspectRatio:
          expandedHeight > 0 ? Math.round((expandedWidth / expandedHeight) * 1000) / 1000 : null,
      });
    }
  }, [
    activeUrl,
    activeIndex,
    activeUrls.length,
    activeOverlayPost,
    expandedWidth,
    expandedHeight,
    screenWidth,
    screenHeight,
  ]);

  useEffect(() => {
    panelMinHeightReportedRef.current = false;
  }, [activeOverlayPost]);

  /** Sheet is closed initially (absolute overlay only); opens to 60% when user taps comment or show more. */
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    if (!activeOverlayPost) setSheetOpen(false);
  }, [activeOverlayPost]);

  /** Sync sheetOpen with panel height; only runOnJS when threshold crosses to avoid 60fps setState during animation. */
  const setSheetOpenFromReaction = useCallback((open: boolean) => {
    setSheetOpen(open);
  }, []);
  useAnimatedReaction(
    () => panelHeightSv.value > 10,
    (isOpen, wasOpen) => {
      if (wasOpen !== undefined && isOpen !== wasOpen) {
        runOnJS(setSheetOpenFromReaction)(isOpen);
      }
    },
    [setSheetOpenFromReaction, panelHeightSv]
  );

  /** Fade absolute overlay bar in when sheet is closed, out when sheet opens or overlay closes. */
  useEffect(() => {
    if (!activeOverlayPost) {
      absoluteOverlayOpacitySv.value = withTiming(0, { duration: 150 });
      return;
    }
    if (sheetOpen) {
      absoluteOverlayOpacitySv.value = withTiming(0, { duration: 180 });
    } else {
      absoluteOverlayOpacitySv.value = withTiming(1, { duration: 220 });
    }
  }, [activeOverlayPost, sheetOpen, absoluteOverlayOpacitySv]);

  /** Open sheet with spring for fluid feel; no setState so no re-render/mount during animation. */
  const openSheet = useCallback(() => {
    const snap60 = screenHeight * BOTTOM_PANEL_SHEET_SNAP_60_FRACTION;
    setPanelContentMinHeight(snap60);
    panelHeightSv.value = withSpring(snap60, {
      dampingRatio: 0.82,
      duration: 520,
    });
  }, [screenHeight, setPanelContentMinHeight, panelHeightSv]);

  const onReplyPress = useCallback(() => {
    if (!activeOverlayPost) return;
    router.push({
      pathname: '/(user-flow)/thread' as any,
      params: { eventId: activeOverlayPost.event.id },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depend on event.id only so memoized panel gets stable callback
  }, [activeOverlayPost?.event.id]);

  const rContainerStyle = useAnimatedStyle(() => ({
    pointerEvents: imageState.value === 'open' ? 'auto' : 'none',
    opacity: imageState.value === 'open' ? 1 : 0,
  }));

  const rImageStyle = useAnimatedStyle(() => ({
    left: imageXCoord.value,
    top: imageYCoord.value,
    width: imageWidth.value,
    height: imageHeight.value,
    opacity: imageState.value === 'open' ? 1 : 0,
    overflow: 'hidden' as const,
    transform: [{ scale: imageScale.value }],
  }));

  const rPagerScaleStyle = useAnimatedStyle(() => {
    'worklet';
    const ew = expandedWidthSv.value;
    const eh = expandedHeightSv.value;
    const w = imageWidth.value;
    const h = imageHeight.value;
    // Uniform scale so content keeps aspect ratio (no squash). Use max so content fills (w,h) and overflow is cropped; min made it too small.
    const scale = ew > 0 && eh > 0 ? Math.max(w / ew, h / eh) : 1;
    const translateX = (w - ew) / 2;
    const translateY = (h - eh) / 2;
    return {
      width: ew,
      height: eh,
      overflow: 'hidden' as const,
      transform: [{ translateX }, { translateY }, { scale }],
    };
  }, [expandedWidth, expandedHeight, expandedWidthSv, expandedHeightSv]);

  const urlCount = activeUrls.length;
  const rPagerRowStyle = useAnimatedStyle(() => {
    'worklet';
    const ew = expandedWidthSv.value;
    const eh = expandedHeightSv.value;
    const x = -pagerOffsetSv.value * ew;
    return {
      width: ew * Math.max(1, urlCount),
      height: eh,
      transform: [{ translateX: x }],
    };
  }, [expandedWidth, expandedHeight, expandedWidthSv, expandedHeightSv, urlCount]);

  const backdropAnimatedProps = useAnimatedProps(() => ({
    intensity: blurIntensity.value,
  }));

  const rCloseBtnStyle = useAnimatedStyle(() => ({
    opacity: closeBtnOpacity.value * overlayUIVisible.value * (panelHeightSv.value <= 10 ? 1 : 0),
  }));

  /** Fade dots only during drag-to-dismiss (not affected by tap-on-image toggle). */
  const rDotPagerStyle = useAnimatedStyle(() => ({
    opacity: closeBtnOpacity.value,
  }));

  /** Fade bottom panel with close button during dismiss. Tap image toggles overlayUIVisible. */
  const rBottomPanelStyle = useAnimatedStyle(() => ({
    opacity: closeBtnOpacity.value * overlayUIVisible.value,
  }));

  /** Absolute overlay bar opacity: fades in when sheet closed, fades out when sheet opens; still tied to closeBtn/overlayUI for dismiss. */
  const rAbsoluteOverlayBarOpacityStyle = useAnimatedStyle(() => ({
    opacity: absoluteOverlayOpacitySv.value * closeBtnOpacity.value * overlayUIVisible.value,
  }));

  /** Panel position/size driven by panelHeightSv. */
  const rBottomPanelLayoutStyle = useAnimatedStyle(() => {
    const h = panelHeightSv.value;
    return {
      top: screenHeight - h,
      height: h,
    };
  }, [screenHeight, panelHeightSv]);

  /** When true, dismiss pan was active; skip image tap-to-toggle so drag-to-dismiss doesn't trigger toggle. */
  const dismissPanActiveRef = useRef(false);
  const clearDismissPanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setDismissPanActive = useCallback((active: boolean) => {
    if (clearDismissPanTimeoutRef.current) {
      clearTimeout(clearDismissPanTimeoutRef.current);
      clearDismissPanTimeoutRef.current = null;
    }
    if (active) {
      dismissPanActiveRef.current = true;
    } else {
      clearDismissPanTimeoutRef.current = setTimeout(() => {
        dismissPanActiveRef.current = false;
        clearDismissPanTimeoutRef.current = null;
      }, 200);
    }
  }, []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(DISMISS_MIN_DISTANCE)
        .activeOffsetY([-DISMISS_ACTIVE_OFFSET_Y, DISMISS_ACTIVE_OFFSET_Y])
        .failOffsetX([-DISMISS_FAIL_OFFSET_X, DISMISS_FAIL_OFFSET_X])
        .onStart(() => {
          dismissPanActive.value = 1;
          runOnJS(setDismissPanActive)(true);
          panStartX.value = imageXCoord.value;
          panStartY.value = imageYCoord.value;
          if (__DEV__) {
            scheduleOnRN(
              logImageVerbosePanStart,
              panStartX.value,
              panStartY.value,
              imageXCoord.value,
              imageYCoord.value,
              imageWidth.value,
              imageHeight.value
            );
          }
          scheduleOnRN(logPerfPanStart);
          scheduleOnRN(logDismissPanStart);
          closeBtnOpacity.value = withTiming(0, {
            duration: DISMISS_CLOSE_BTN_FADE_DURATION_MS,
          });
        })
        .onChange((event) => {
          if (imageState.value === 'close') return;
          imageXCoord.value += event.changeX * DISMISS_DRAG_FOLLOW;
          imageYCoord.value += event.changeY * DISMISS_DRAG_FOLLOW;
          const deltaX = imageXCoord.value - panStartX.value;
          const deltaY = imageYCoord.value - panStartY.value;
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          const dragRange = screenWidth * DISMISS_DRAG_RANGE_FRACTION;
          const scale = interpolate(distance, [0, dragRange], [1, DISMISS_SCALE_AT_DRAG], {
            extrapolateRight: 'clamp',
          });
          const blur = interpolate(distance, [0, dragRange], [DISMISS_BLUR_AT_REST, 0], {
            extrapolateRight: 'clamp',
          });
          imageScale.value = scale;
          blurIntensity.value = blur;
        })
        .onFinalize((event) => {
          const wasActive = dismissPanActive.value === 1;
          dismissPanActive.value = 0;
          const deltaX = imageXCoord.value - panStartX.value;
          const deltaY = imageYCoord.value - panStartY.value;
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          const ew = expandedWidthSv.value || expandedWidth;
          const eh = expandedHeightSv.value || expandedHeight;
          const threshold = Math.max(ew, eh) * DISMISS_THRESHOLD_FRACTION;
          const dismissed = distance > threshold;
          if (__DEV__) {
            scheduleOnRN(
              logImageVerbosePanFinalize,
              deltaX,
              deltaY,
              distance,
              ew,
              eh,
              threshold,
              dismissed,
              event.translationX,
              event.translationY
            );
          }
          scheduleOnRN(logPerfPanFinalize, distance, threshold, dismissed);
          scheduleOnRN(
            logDismissPanFinalize,
            event.translationX,
            event.translationY,
            distance,
            threshold,
            dismissed
          );
          runOnJS(setDismissPanActive)(false);
          imageScale.value = withTiming(1, IMAGE_OVERLAY_TIMING_CONFIG);
          if (!wasActive) return;
          if (dismissed) {
            close();
          } else {
            openToCenter();
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values are stable refs
    [
      expandedWidth,
      expandedHeight,
      expandedWidthSv,
      expandedHeightSv,
      screenWidth,
      setDismissPanActive,
    ]
  );

  const closeRef = useRef(close);
  closeRef.current = close;
  const triggerClose = useCallback(() => {
    const fn = closeRef.current;
    if (fn) scheduleOnUI(fn);
  }, []);

  const toggleOverlayUI = useCallback(() => {
    scheduleOnUI(() => {
      'worklet';
      const next = overlayUIVisible.value === 1 ? 0 : 1;
      overlayUIVisible.value = withTiming(next, { duration: 200 });
    });
  }, [overlayUIVisible]);

  /** When true, a pager drag is in progress or just ended; skip image tap-to-toggle. */
  const pagerDragActiveRef = useRef(false);
  const clearPagerDragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleImagePress = useCallback(() => {
    if (pagerDragActiveRef.current || dismissPanActiveRef.current) return;
    toggleOverlayUI();
  }, [toggleOverlayUI]);
  const setPagerDragActive = useCallback((active: boolean) => {
    if (clearPagerDragTimeoutRef.current) {
      clearTimeout(clearPagerDragTimeoutRef.current);
      clearPagerDragTimeoutRef.current = null;
    }
    if (active) {
      pagerDragActiveRef.current = true;
    } else {
      clearPagerDragTimeoutRef.current = setTimeout(() => {
        pagerDragActiveRef.current = false;
        clearPagerDragTimeoutRef.current = null;
      }, 200);
    }
  }, []);

  /** Max finger movement (px) for tap to count; prevents swipe-to-page from triggering toggle. */
  const TAP_MAX_DISTANCE = 12;

  /** Tap on blur only → dismiss. Tap on image → do not dismiss (handled by Pressable for toggle). */
  const tapBackdrop = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(TAP_MAX_DISTANCE)
        .onEnd((e) => {
          if (imageState.value === 'close') return;
          const x = e.x;
          const y = e.y;
          const ix = imageXCoord.value;
          const iy = imageYCoord.value;
          const iw = imageWidth.value;
          const ih = imageHeight.value;
          const insideImage = x >= ix && x <= ix + iw && y >= iy && y <= iy + ih;
          if (insideImage) return;
          const effectiveBottom = activeOverlayPost
            ? panelHeightSv.value > 0
              ? panelHeightSv.value
              : BOTTOM_PANEL_ABSOLUTE_OVERLAY_HEIGHT
            : BOTTOM_PANEL_SAFE_HEIGHT;
          const panelTopY = screenHeight - effectiveBottom;
          const insideBottomPanel = y >= panelTopY;
          if (insideBottomPanel) return;
          runOnJS(triggerClose)();
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worklet reads shared values
    [triggerClose, screenHeight, activeOverlayPost, panelHeightSv]
  );

  const panelDragStartSv = useSharedValue(0);
  const panelMaxHeight = Math.max(
    0,
    screenHeight * BOTTOM_PANEL_MAX_HEIGHT_FRACTION - BOTTOM_PANEL_MAX_HEIGHT_INSET_PX
  );
  const snap60Height = screenHeight * BOTTOM_PANEL_SHEET_SNAP_60_FRACTION;
  const scrollOffsetYInPanel = useSharedValue(0);
  /** When touch is in scroll area we delay activate/fail until onTouchesMove to detect drag direction. */
  const panelTouchStartYSv = useSharedValue(-1);

  const panelScrollHandler = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      scrollOffsetYInPanel.value = e.nativeEvent.contentOffset.y;
    },
    [scrollOffsetYInPanel]
  );

  /** Min movement (px) in scroll area before we activate/fail. */
  const PANEL_DRAG_THRESHOLD = 10;
  const SCROLL_AT_TOP_THRESHOLD = 2;
  /** When sheet is below this height, any drag resizes; above it, only at-top + drag-down resizes. */
  const scrollVsDragMidHeight = (snap60Height + panelMaxHeight) / 2;

  /** Handle-only pan: only sheet resize, no scroll. Snap to 0 / 60% / 100%; at 0 run setSheetOpen(false). */
  const handlePan = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          panelDragStartSv.value = panelHeightSv.value;
        })
        .onChange((e) => {
          const maxH = panelMaxHeight;
          const next = panelDragStartSv.value - e.translationY;
          panelHeightSv.value = Math.max(0, Math.min(maxH, next));
        })
        .onEnd((e) => {
          'worklet';
          const current = panelHeightSv.value;
          const velocityY = -e.velocityY;
          const SNAP_0 = 0;
          const SNAP_60 = snap60Height;
          const SNAP_100 = panelMaxHeight;
          const t30 = screenHeight * 0.3;
          const t80 = screenHeight * 0.8;
          let snapTo: number;
          if (velocityY > 250) snapTo = SNAP_100;
          else if (velocityY < -250) snapTo = current < screenHeight * 0.5 ? SNAP_0 : SNAP_60;
          else if (current < t30) snapTo = SNAP_0;
          else if (current < t80) snapTo = SNAP_60;
          else snapTo = SNAP_100;
          const closeSheet = snapTo <= 0;
          panelHeightSv.value = withTiming(
            snapTo,
            {
              duration: BOTTOM_PANEL_STIFF_DURATION_MS,
              easing: Easing.out(Easing.cubic),
            },
            (finished) => {
              'worklet';
              if (finished && closeSheet) runOnJS(setSheetOpenFromReaction)(false);
            }
          );
        }),
    [
      panelHeightSv,
      panelDragStartSv,
      panelMaxHeight,
      snap60Height,
      screenHeight,
      setSheetOpenFromReaction,
    ]
  );

  /**
   * Scroll-area pan: below 60% any drag resizes; at 60%/100% only at-top + drag-down resizes.
   * Snap to 0 / 60% / 100%; at 0 run setSheetOpen(false).
   */
  const scrollAreaPanRef = useRef<GestureType | undefined>(undefined);
  const scrollAreaPan = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .onTouchesDown((e, stateManager) => {
          'worklet';
          if (e.numberOfTouches !== 1) {
            stateManager.fail();
            return;
          }
          panelTouchStartYSv.value = e.allTouches[0]?.y ?? 0;
        })
        .onTouchesMove((e, stateManager) => {
          'worklet';
          if (panelTouchStartYSv.value < 0) return;
          if (e.numberOfTouches !== 1) {
            panelTouchStartYSv.value = -1;
            stateManager.fail();
            return;
          }
          const touchY = e.allTouches[0]?.y ?? 0;
          const deltaY = touchY - panelTouchStartYSv.value;
          const sheetAtSmallSnap = panelHeightSv.value < scrollVsDragMidHeight;
          const draggedDown = deltaY >= PANEL_DRAG_THRESHOLD;
          const draggedUp = deltaY <= -PANEL_DRAG_THRESHOLD;
          if (draggedDown || draggedUp) {
            panelTouchStartYSv.value = -1;
            if (sheetAtSmallSnap) {
              stateManager.activate();
            } else {
              const scrollAtTop = scrollOffsetYInPanel.value <= SCROLL_AT_TOP_THRESHOLD;
              if (scrollAtTop && draggedDown) {
                stateManager.activate();
              } else {
                stateManager.fail();
              }
            }
          }
        })
        .onTouchesUp((_e, stateManager) => {
          'worklet';
          if (panelTouchStartYSv.value >= 0) {
            panelTouchStartYSv.value = -1;
            stateManager.fail();
          }
        })
        .onTouchesCancelled((_e, stateManager) => {
          'worklet';
          if (panelTouchStartYSv.value >= 0) {
            panelTouchStartYSv.value = -1;
            stateManager.fail();
          }
        })
        .onStart(() => {
          panelDragStartSv.value = panelHeightSv.value;
        })
        .onChange((e) => {
          const maxH = panelMaxHeight;
          const next = panelDragStartSv.value - e.translationY;
          panelHeightSv.value = Math.max(0, Math.min(maxH, next));
        })
        .onEnd((e) => {
          'worklet';
          const current = panelHeightSv.value;
          const velocityY = -e.velocityY;
          const SNAP_0 = 0;
          const SNAP_60 = snap60Height;
          const SNAP_100 = panelMaxHeight;
          const t30 = screenHeight * 0.3;
          const t80 = screenHeight * 0.8;
          let snapTo: number;
          if (velocityY > 250) snapTo = SNAP_100;
          else if (velocityY < -250) snapTo = current < screenHeight * 0.5 ? SNAP_0 : SNAP_60;
          else if (current < t30) snapTo = SNAP_0;
          else if (current < t80) snapTo = SNAP_60;
          else snapTo = SNAP_100;
          const closeSheet = snapTo <= 0;
          panelHeightSv.value = withTiming(
            snapTo,
            {
              duration: BOTTOM_PANEL_STIFF_DURATION_MS,
              easing: Easing.out(Easing.cubic),
            },
            (finished) => {
              'worklet';
              if (finished && closeSheet) runOnJS(setSheetOpenFromReaction)(false);
            }
          );
        })
        .withRef(scrollAreaPanRef),
    [
      panelHeightSv,
      panelDragStartSv,
      panelMaxHeight,
      snap60Height,
      screenHeight,
      scrollVsDragMidHeight,
      panelTouchStartYSv,
      scrollOffsetYInPanel,
      setSheetOpenFromReaction,
    ]
  );

  const horizontalPan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(hasMultipleImages)
        .activeOffsetX([-PAGER_ACTIVE_OFFSET_X, PAGER_ACTIVE_OFFSET_X])
        .failOffsetY([-PAGER_FAIL_OFFSET_Y, PAGER_FAIL_OFFSET_Y])
        .minDistance(PAGER_MIN_DISTANCE)
        .onStart(() => {
          if (imageState.value !== 'open') return;
          runOnJS(setPagerDragActive)(true);
          scheduleOnRN(logPagerPanStart);
          startPagerOffsetSv.value = pagerOffsetSv.value;
        })
        .onChange((e) => {
          if (imageState.value !== 'open') return;
          const ew = expandedWidthSv.value || expandedWidth;
          const delta = -e.translationX / ew;
          const next = startPagerOffsetSv.value + delta;
          pagerOffsetSv.value = Math.max(0, Math.min(maxPagerIndex, next));
        })
        .onEnd((e) => {
          if (imageState.value !== 'open') return;
          const ew = expandedWidthSv.value || expandedWidth;
          const delta = -e.translationX / ew;
          const current = startPagerOffsetSv.value + delta;
          const velocity = -e.velocityX / ew;
          const effective = current + velocity * PAGER_VELOCITY_WEIGHT;
          let snapTo = Math.max(0, Math.min(maxPagerIndex, Math.round(effective)));
          const startIndex = Math.round(startPagerOffsetSv.value);
          if (velocity >= PAGER_FLICK_VELOCITY_THRESHOLD && startIndex < maxPagerIndex) {
            snapTo = startIndex + 1;
          } else if (velocity <= -PAGER_FLICK_VELOCITY_THRESHOLD && startIndex > 0) {
            snapTo = startIndex - 1;
          }
          const didChangePage = snapTo !== startIndex;
          scheduleOnRN(
            logPagerPanEnd,
            e.translationX,
            e.velocityX,
            snapTo,
            startIndex,
            didChangePage
          );
          const initialVelocity = didChangePage
            ? 0
            : Math.max(-PAGER_VELOCITY_CLAMP, Math.min(PAGER_VELOCITY_CLAMP, velocity));
          const springConfig = didChangePage ? SNAP_SPRING_PAGE_CHANGE : SNAP_SPRING_SAME_PAGE;
          pagerOffsetSv.value = withSpring(
            snapTo,
            {
              ...springConfig,
              velocity: initialVelocity,
            },
            (finished) => {
              if (finished && didChangePage) {
                runOnJS(setActiveIndex)(snapTo);
              }
            }
          );
          runOnJS(setPagerDragActive)(false);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values stable refs
    [
      hasMultipleImages,
      expandedWidth,
      expandedWidthSv,
      maxPagerIndex,
      setActiveIndex,
      setPagerDragActive,
    ]
  );

  const composed = useMemo(
    () =>
      hasMultipleImages
        ? Gesture.Exclusive(horizontalPan, pan, tapBackdrop)
        : Gesture.Exclusive(pan, tapBackdrop),
    [hasMultipleImages, horizontalPan, pan, tapBackdrop]
  );

  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: 9999 }]}
      pointerEvents={activeUrl ? 'auto' : 'none'}>
      <GestureDetector gesture={composed}>
        <AnimatedPressable style={[StyleSheet.absoluteFill, rContainerStyle]}>
          {/* box-none so taps on the blur fall through to the gesture (tapBackdrop → triggerClose); overlay root still blocks content behind */}
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none" />
          <AnimatedBlurView
            tint="dark"
            style={StyleSheet.absoluteFill}
            animatedProps={backdropAnimatedProps}
            pointerEvents="none"
          />
          <Animated.View
            style={[
              styles.closeButton,
              { top: insets.top + CLOSE_BUTTON_TOP_OFFSET },
              rCloseBtnStyle,
            ]}>
            <Pressable onPress={triggerClose} style={StyleSheet.absoluteFill}>
              <Icon name="material-symbols:close-rounded" size={22} color="#fff" />
            </Pressable>
          </Animated.View>
          {activeUrl ? (
            <Animated.View style={[styles.imageWrap, rImageStyle]}>
              {hasMultipleImages ? (
                <>
                  <Pressable style={StyleSheet.absoluteFill} onPress={handleImagePress}>
                    <Animated.View style={rPagerScaleStyle}>
                      <Animated.View style={rPagerRowStyle}>
                        {activeUrls.map((url, i) => (
                          <MemoizedPagerPageAnimated
                            key={url}
                            url={url}
                            index={i}
                            expandedWidthSv={expandedWidthSv}
                            expandedHeightSv={expandedHeightSv}
                          />
                        ))}
                      </Animated.View>
                    </Animated.View>
                  </Pressable>
                  <Animated.View style={[styles.dotPager, rDotPagerStyle]} pointerEvents="none">
                    {activeUrls.map((_, i) => (
                      <OverlayDot
                        key={i}
                        index={i}
                        pagerOffsetSv={pagerOffsetSv}
                        activeColor={DOTS_ACTIVE_COLOR}
                      />
                    ))}
                  </Animated.View>
                </>
              ) : (
                <Pressable style={StyleSheet.absoluteFill} onPress={handleImagePress}>
                  <Image
                    source={{ uri: activeUrl }}
                    style={StyleSheet.absoluteFill}
                    contentFit="contain"
                    cachePolicy="memory-disk"
                  />
                </Pressable>
              )}
            </Animated.View>
          ) : null}
        </AnimatedPressable>
      </GestureDetector>
      {activeOverlayPost ? (
        <Animated.View
          style={[
            styles.absoluteOverlayBar,
            rAbsoluteOverlayBarOpacityStyle,
            {
              bottom: 0,
              paddingBottom: insets.bottom + BOTTOM_PANEL_PADDING_BOTTOM_EXTRA,
            },
          ]}
          pointerEvents={sheetOpen ? 'none' : 'auto'}>
          <ImageOverlayAbsoluteBar post={activeOverlayPost} onOpenSheet={openSheet} />
        </Animated.View>
      ) : null}
      {activeOverlayPost ? (
        <Animated.View
          style={[
            styles.bottomPanel,
            rBottomPanelStyle,
            rBottomPanelLayoutStyle,
            {
              paddingBottom: insets.bottom + BOTTOM_PANEL_PADDING_BOTTOM_EXTRA,
            },
          ]}
          pointerEvents="auto">
          <View style={styles.panelContentWrap} collapsable={false}>
            <GestureDetector gesture={handlePan}>
              <View style={styles.panelHandle} collapsable={false}>
                <View style={styles.panelHandleBar} />
              </View>
            </GestureDetector>
            <GestureDetector gesture={scrollAreaPan}>
              <View style={styles.panelScrollAndReplyWrap}>
                <GHScrollView
                  waitFor={scrollAreaPanRef}
                  onScroll={panelScrollHandler}
                  scrollEventThrottle={16}
                  style={styles.bottomPanelScroll}
                  contentContainerStyle={styles.bottomPanelScrollContent}
                  showsVerticalScrollIndicator={true}>
                  <View
                    onLayout={() => {
                      if (panelMinHeightReportedRef.current) return;
                      setPanelContentMinHeight(snap60Height);
                      panelMinHeightReportedRef.current = true;
                    }}
                    collapsable={false}>
                    <ImageOverlayBottomPanelContent post={activeOverlayPost} />
                  </View>
                </GHScrollView>
                <View style={styles.bottomPanelReplyWrap} collapsable={false}>
                  <ImageOverlayBottomPanelReply
                    currentUserPubkey={nostrKeys?.pubkey ?? null}
                    onReplyPress={onReplyPress}
                  />
                </View>
              </View>
            </GestureDetector>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

/**
 * Renders the image overlay. On native, wraps in FullWindowOverlay (from
 * react-native-screens) so it appears above the Expo Router tab bar and
 * header — same approach as VideoFeedOverlay.
 */
export function AnimatedImageOverlay() {
  const ctx = useImageOverlay();
  if (!ctx) return null;
  const content = <AnimatedImageOverlayContent ctx={ctx} />;
  if (Platform.OS === 'web') return content;
  return <FullWindowOverlay>{content}</FullWindowOverlay>;
}

const styles = StyleSheet.create({
  closeButton: {
    position: 'absolute',
    left: CLOSE_BUTTON_LEFT,
    backgroundColor: CLOSE_BUTTON_BG,
    padding: CLOSE_BUTTON_PADDING,
    borderRadius: 9999,
  },
  imageWrap: {
    position: 'absolute',
    borderRadius: IMAGE_WRAP_BORDER_RADIUS,
    overflow: 'hidden',
    transformOrigin: 'center',
  },
  dotPager: {
    position: 'absolute',
    bottom: DOT_PAGER_BOTTOM,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  absoluteOverlayBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 1,
    backgroundColor: 'transparent',
  },
  bottomPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 2,
    backgroundColor: PANEL_BG,
  },
  panelContentWrap: {
    flex: 1,
    minHeight: 0,
  },
  panelScrollAndReplyWrap: {
    flex: 1,
    minHeight: 0,
  },
  panelHandle: {
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  panelHandleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  bottomPanelScroll: {
    flex: 1,
  },
  bottomPanelScrollContent: {
    flexGrow: 1,
  },
  bottomPanelReplyWrap: {
    paddingHorizontal: BOTTOM_PANEL_PADDING_HORIZONTAL,
    paddingTop: 8,
    paddingBottom: 0,
  },
});
