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
import { formatTimestamp, formatCount, formatSats } from './shared';
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
  BOTTOM_PANEL_MAX_HEIGHT_FRACTION,
  BOTTOM_PANEL_SAFE_HEIGHT,
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

/** Scrollable part of the bottom panel: author, note content (with show more), metrics. */
const ImageOverlayBottomPanelContent = React.memo(function ImageOverlayBottomPanelContent({
  post,
}: {
  post: ImageOverlayPost;
}) {
  const [contentExpanded, setContentExpanded] = useState(false);
  const { event, metrics, profile, reposted, liked, onCommentPress, onRepostPress, onLikePress } =
    post;
  const displayName = profile?.name ?? `${event.pubkey.slice(0, 8)}…`;
  const shortTime = formatTimestamp(event.created_at);
  const fullContent = event.content.trim();
  const contentPreview = fullContent.slice(0, 120);
  const contentTruncated = fullContent.length > 120;
  const showContent = contentExpanded ? fullContent : contentPreview;
  const showEllipsis = contentTruncated && !contentExpanded;

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
      {/* Post content with show more */}
      {fullContent.length > 0 ? (
        <View>
          <Text
            size={14}
            style={[bottomPanelStyles.contentText, { color: PANEL_TEXT_MUTED }]}
            numberOfLines={contentExpanded ? undefined : 2}>
            {showContent}
            {showEllipsis ? '…' : ''}
          </Text>
          {contentTruncated && (
            <Text
              size={14}
              style={[bottomPanelStyles.contentText, { color: PANEL_TEXT_MUTED, marginTop: 4 }]}
              onPress={() => setContentExpanded((e) => !e)}>
              {contentExpanded ? 'show less' : 'show more'}
            </Text>
          )}
        </View>
      ) : null}
      {/* Stats / actions row */}
      <View style={bottomPanelStyles.metricsRow}>
        <Pressable
          onPress={onCommentPress}
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

/** Height reserved for the fixed reply row (avatar 28 + padding) for min panel height. */
const BOTTOM_PANEL_REPLY_ROW_HEIGHT = 44;

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
    panelContentMinHeightSv,
    setPanelHeight,
    setPanelContentMinHeight,
    startOpenPanelImageAnimation,
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
    opacity: closeBtnOpacity.value * overlayUIVisible.value,
  }));

  /** Fade dots only during drag-to-dismiss (not affected by tap-on-image toggle). */
  const rDotPagerStyle = useAnimatedStyle(() => ({
    opacity: closeBtnOpacity.value,
  }));

  /** Fade bottom panel with close button during dismiss. Tap image toggles overlayUIVisible. */
  const rBottomPanelStyle = useAnimatedStyle(() => ({
    opacity: closeBtnOpacity.value * overlayUIVisible.value,
  }));

  /** Panel position/size driven by panelHeightSv so image area updates when panel is dragged. */
  const rBottomPanelLayoutStyle = useAnimatedStyle(() => {
    const h = panelHeightSv.value;
    // Fallback so panel is visible on first frame when open() set panelHeightSv from JS (UI thread may read before update)
    const effectiveHeight = h <= 0 ? screenHeight * BOTTOM_PANEL_MAX_HEIGHT_FRACTION : h;
    return {
      top: screenHeight - effectiveHeight,
      height: effectiveHeight,
    };
  }, [screenHeight, panelHeightSv]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(DISMISS_MIN_DISTANCE)
        .activeOffsetY([-DISMISS_ACTIVE_OFFSET_Y, DISMISS_ACTIVE_OFFSET_Y])
        .failOffsetX([-DISMISS_FAIL_OFFSET_X, DISMISS_FAIL_OFFSET_X])
        .onStart(() => {
          dismissPanActive.value = 1;
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
          imageScale.value = withTiming(1, IMAGE_OVERLAY_TIMING_CONFIG);
          if (!wasActive) return;
          if (dismissed) {
            close();
          } else {
            openToCenter();
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values are stable refs
    [expandedWidth, expandedHeight, expandedWidthSv, expandedHeightSv, screenWidth]
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
    if (pagerDragActiveRef.current) return;
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
          const panelTopY = activeOverlayPost
            ? screenHeight - panelHeightSv.value
            : screenHeight - BOTTOM_PANEL_SAFE_HEIGHT;
          const insideBottomPanel = y >= panelTopY;
          if (insideBottomPanel) return;
          runOnJS(triggerClose)();
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worklet reads shared values
    [triggerClose, screenHeight, activeOverlayPost, panelHeightSv]
  );

  const panelDragStartSv = useSharedValue(0);
  const panelMaxHeight = screenHeight * BOTTOM_PANEL_MAX_HEIGHT_FRACTION;
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
  /** When sheet height is below this fraction of range (min→max), any drag in content resizes sheet; above it, scroll is allowed at 70%. */
  const PANEL_SCROLL_VS_DRAG_MID_FRACTION = 0.5;

  /** Handle-only pan: only sheet resize, no scroll. Attached only to the handle. */
  const handlePan = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          panelDragStartSv.value = panelHeightSv.value;
        })
        .onChange((e) => {
          const minH = panelContentMinHeightSv.value;
          const maxH = panelMaxHeight;
          const next = panelDragStartSv.value - e.translationY;
          panelHeightSv.value = Math.max(minH, Math.min(maxH, next));
        })
        .onEnd((e) => {
          const minH = panelContentMinHeightSv.value;
          const maxH = panelMaxHeight;
          const current = panelHeightSv.value;
          const mid = (minH + maxH) / 2;
          const velocityY = -e.velocityY;
          let snapTo: number;
          if (velocityY > 200) snapTo = maxH;
          else if (velocityY < -200) snapTo = minH;
          else snapTo = current < mid ? minH : maxH;
          panelHeightSv.value = withTiming(snapTo, {
            duration: BOTTOM_PANEL_STIFF_DURATION_MS,
            easing: Easing.out(Easing.cubic),
          });
        }),
    [panelHeightSv, panelDragStartSv, panelContentMinHeightSv, panelMaxHeight]
  );

  /**
   * Scroll-area pan: at small snap (min height) any drag resizes the sheet; at 70% (max) snap
   * we use scroll (only at-top + drag-down resizes). Seamless transition between the two.
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
          const minH = panelContentMinHeightSv.value;
          const maxH = panelMaxHeight;
          const range = maxH - minH;
          const midHeight = minH + range * PANEL_SCROLL_VS_DRAG_MID_FRACTION;
          const sheetAtSmallSnap = panelHeightSv.value < midHeight;
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
          const minH = panelContentMinHeightSv.value;
          const maxH = panelMaxHeight;
          const next = panelDragStartSv.value - e.translationY;
          panelHeightSv.value = Math.max(minH, Math.min(maxH, next));
        })
        .onEnd((e) => {
          const minH = panelContentMinHeightSv.value;
          const maxH = panelMaxHeight;
          const current = panelHeightSv.value;
          const mid = (minH + maxH) / 2;
          const velocityY = -e.velocityY;
          let snapTo: number;
          if (velocityY > 200) snapTo = maxH;
          else if (velocityY < -200) snapTo = minH;
          else snapTo = current < mid ? minH : maxH;
          panelHeightSv.value = withTiming(snapTo, {
            duration: BOTTOM_PANEL_STIFF_DURATION_MS,
            easing: Easing.out(Easing.cubic),
          });
        })
        .withRef(scrollAreaPanRef),
    [
      panelHeightSv,
      panelDragStartSv,
      panelContentMinHeightSv,
      panelMaxHeight,
      panelTouchStartYSv,
      scrollOffsetYInPanel,
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
          <Pressable
            onPress={triggerClose}
            style={[styles.closeButton, { top: insets.top + CLOSE_BUTTON_TOP_OFFSET }]}>
            <Animated.View style={rCloseBtnStyle}>
              <Icon name="material-symbols:close-rounded" size={22} color="#fff" />
            </Animated.View>
          </Pressable>
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
                    onLayout={(e) => {
                      if (panelMinHeightReportedRef.current) return;
                      const contentHeight = e.nativeEvent.layout.height;
                      const handleHeight = 24;
                      const minPanelHeight = Math.min(
                        contentHeight +
                          handleHeight +
                          BOTTOM_PANEL_REPLY_ROW_HEIGHT +
                          insets.bottom +
                          BOTTOM_PANEL_PADDING_BOTTOM_EXTRA,
                        panelMaxHeight
                      );
                      if (__DEV__) {
                        console.log('[Image:panelOnLayout]', {
                          contentHeight,
                          handleHeight,
                          replyRowHeight: BOTTOM_PANEL_REPLY_ROW_HEIGHT,
                          insetsBottom: insets.bottom,
                          panelMaxHeight,
                          minPanelHeight,
                        });
                        const sumBeforeClamp =
                          contentHeight +
                          handleHeight +
                          BOTTOM_PANEL_REPLY_ROW_HEIGHT +
                          insets.bottom +
                          BOTTOM_PANEL_PADDING_BOTTOM_EXTRA;
                        logImageVerbose('panel onLayout', {
                          contentHeight,
                          handleHeight,
                          replyRowHeight: BOTTOM_PANEL_REPLY_ROW_HEIGHT,
                          insetsBottom: insets.bottom,
                          BOTTOM_PANEL_PADDING_BOTTOM_EXTRA,
                          formula:
                            'min(contentHeight + handleHeight + replyRow + insets.bottom + paddingExtra, panelMaxHeight)',
                          sumBeforeClamp,
                          panelMaxHeight,
                          minPanelHeight,
                          clamped: sumBeforeClamp > panelMaxHeight,
                          thenCalls: [
                            'setPanelContentMinHeight(minPanelHeight)',
                            'startOpenPanelImageAnimation(minPanelHeight)',
                            'setPanelHeight(minPanelHeight)',
                          ],
                        });
                      }
                      setPanelContentMinHeight(minPanelHeight);
                      // Animate image to final position (for min panel) so no overshoot; panel animates 70%→min in parallel
                      startOpenPanelImageAnimation(minPanelHeight);
                      setPanelHeight(minPanelHeight);
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
  bottomPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
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
