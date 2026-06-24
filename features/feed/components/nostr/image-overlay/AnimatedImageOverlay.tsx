/**
 * Fullscreen image overlay with blur, pan-to-dismiss, horizontal pager, and bottom sheet.
 * Renders only when ImageOverlayProvider is present and activeUrl is set.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { BackHandler, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import {
  type GestureType,
  Gesture,
  GestureDetector,
  ScrollView as GHScrollView,
} from 'react-native-gesture-handler';
import { FullWindowOverlay } from 'react-native-screens';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { BlurView } from 'expo-blur';
import opacity from 'hex-color-opacity';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { ThreadReplyBar } from '@/features/feed/components/ThreadReplyBar';
import { Log } from '@/shared/lib/logger';
import Icon from 'assets/icons';
import type { ImageOverlayContextValue } from './types';
import { IMAGE_OVERLAY_TIMING_CONFIG, useImageOverlay } from './provider';
import { clearAndroidOverlayNode, setAndroidOverlayNode } from './AndroidImageOverlayHost';
import { MemoizedMediaPagerPage } from './MediaPagerPage';
import { OverlayDot } from './PagerDots';
import { duration, zIndex } from '@/shared/styles/tokens';
import { ImageOverlayBottomPanelContent, ImageOverlayAbsoluteBar } from './BottomPanel';
import {
  ANDROID_SCRIM_MAX_OPACITY,
  DISMISS_ACTIVE_OFFSET_Y,
  DISMISS_BLUR_AT_REST,
  DISMISS_CLOSE_BTN_FADE_DURATION_MS,
  DISMISS_DRAG_FOLLOW,
  DISMISS_DRAG_RANGE_FRACTION,
  DISMISS_MIN_DISTANCE,
  DISMISS_SCALE_AT_DRAG,
  DISMISS_THRESHOLD_FRACTION,
  DOTS_ACTIVE_COLOR,
  IMAGE_WRAP_BORDER_RADIUS,
  PAGER_ACTIVE_OFFSET_X,
  PAGER_FAIL_OFFSET_Y,
  PAGER_FLICK_VELOCITY_THRESHOLD,
  PAGER_MIN_DISTANCE,
  PAGER_VELOCITY_CLAMP,
  PAGER_VELOCITY_WEIGHT,
  SNAP_SPRING_PAGE_CHANGE,
  SNAP_SPRING_SAME_PAGE,
  SWIPE_UP_ACTIVE_OFFSET_Y,
  SWIPE_UP_FAIL_OFFSET_X,
  SWIPE_UP_CONFIRM_DISTANCE,
  SWIPE_UP_TRANSITION_DURATION_MS,
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
  BOTTOM_PANEL_SHEET_TOP_BORDER_RADIUS,
} from './config';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

function AnimatedImageOverlayContent({
  ctx,
  safeBottom,
}: {
  ctx: ImageOverlayContextValue;
  /** Correct bottom safe-area inset, read outside the FullWindowOverlay (where
   *  `useSafeAreaInsets().bottom` is inflated). Use this for all bottom layout. */
  safeBottom: number;
}) {
  const rawInsets = useSafeAreaInsets();
  // Override the unreliable in-overlay bottom inset with the correct one.
  const insets = { ...rawInsets, bottom: safeBottom };
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  // The sheet is a true bottom drawer (not an overlay on the image), so it reads
  // like the feed it came from: same `surface` background, with the handle and
  // reply divider tinted from `foreground` rather than hardcoded white.
  const [panelSurface, panelForeground] = useThemeColor(['surface', 'foreground'] as const);
  const panelMinHeightReportedRef = useRef(false);

  const imageScale = useSharedValue(1);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const dismissPanActive = useSharedValue(0);
  /** Toggle via tap on image: 1 = show close/panel/dots, 0 = hide to focus on image. */
  const overlayUIVisible = useSharedValue(1);
  /** Opacity for the absolute overlay bar (sheet closed); animated so it fades in/out instead of popping. */
  const absoluteOverlayOpacitySv = useSharedValue(0);
  /** Vertical offset for swipe-to-next transition: 0 = rest, negative = dragged up (current leaving), set to screenHeight then animate to 0 for next entering. */
  const swipeUpTranslateY = useSharedValue(0);
  const animatingToNextRef = useRef(false);

  const {
    activeUrl,
    activeUrls,
    activeMediaTypes,
    activeIndex,
    setActiveIndex,
    activeOverlayPost,
    onSwipeUpToNextPost,
    videoFeedLayouts,
    videoFeedLayoutIndex,
    setVideoFeedLayouts,
    setVideoFeedIndex,
    getVideoFeedLayoutsAndIndex,
    imageState,
    isClosing,
    imageXCoord,
    imageYCoord,
    imageWidth,
    imageHeight,
    closeTargetPageX,
    closeTargetPageY,
    closeTargetWidth,
    closeTargetHeight,
    blurIntensity,
    closeBtnOpacity,
    expandedWidthSv,
    expandedHeightSv,
    panelHeightSv,
    setPanelContentMinHeight,
    close,
    openReplace,
    openToCenter,
  } = ctx;
  /** Image viewport: full width, screen height minus top inset (matches provider's imageViewportHeight). */
  const expandedWidth = screenWidth;
  const expandedHeight = screenHeight - insets.top;

  const hasMultipleMedia = activeUrls.length > 1;
  const maxPagerIndex = Math.max(0, activeUrls.length - 1);
  const isCurrentPageVideo = activeMediaTypes[hasMultipleMedia ? activeIndex : 0] === 'video';
  const isVerticalFeed = !!(videoFeedLayouts && videoFeedLayouts.length > 1);
  const verticalFeedPageCount = videoFeedLayouts?.length ?? 0;

  const pagerOffsetSv = useSharedValue(activeIndex);
  const startPagerOffsetSv = useSharedValue(activeIndex);
  const verticalPagerOffsetSv = useSharedValue(videoFeedLayoutIndex);
  const startVerticalPagerOffsetSv = useSharedValue(videoFeedLayoutIndex);
  /** 1 when current pager page is video (for swipe-up-to-next-post). Updated from JS when activeIndex/activeMediaTypes change. */
  const isCurrentPageVideoSv = useSharedValue(0);
  useEffect(() => {
    const idx = activeIndex;
    const isVideo = activeMediaTypes.length > idx && activeMediaTypes[idx] === 'video';
    isCurrentPageVideoSv.value = isVideo ? 1 : 0;
  }, [activeIndex, activeMediaTypes, isCurrentPageVideoSv]);

  useEffect(() => {
    pagerOffsetSv.value = activeIndex;
  }, [activeIndex, pagerOffsetSv]);

  useEffect(() => {
    verticalPagerOffsetSv.value = videoFeedLayoutIndex;
  }, [videoFeedLayoutIndex, verticalPagerOffsetSv]);

  useEffect(() => {
    if (activeUrl) overlayUIVisible.value = 1;
  }, [activeUrl, overlayUIVisible]);

  /** When overlay opens from a video, enable vertical feed; never switch to video feed when user opened an image. */
  useEffect(() => {
    if (!activeUrl || !getVideoFeedLayoutsAndIndex) return;
    const result = getVideoFeedLayoutsAndIndex();
    if (!result || result.layouts.length <= 1) return;
    const firstLayoutUrl = result.layouts[result.initialIndex]?.url;
    if (firstLayoutUrl !== activeUrl) return;
    setVideoFeedLayouts(result.layouts, result.initialIndex);
  }, [activeUrl, getVideoFeedLayoutsAndIndex, setVideoFeedLayouts]);

  useEffect(() => {
    panelMinHeightReportedRef.current = false;
  }, [activeOverlayPost]);

  /** Sheet is closed initially (absolute overlay only); opens to 60% when user taps comment or show more. */
  const [sheetOpen, setSheetOpen] = useState(false);
  // The floating reply composer's measured height. Used to pad the panel content
  // (so it clears the pinned bar) and to time the bar's fade-out so it disappears
  // before the collapsing drawer gets shorter than the bar (no poke-out).
  const [replyBarHeight, setReplyBarHeight] = useState(0);
  const replyBarHeightSv = useSharedValue(0);
  const handleReplyBarHeight = (height: number) => {
    setReplyBarHeight(height);
    replyBarHeightSv.value = height;
  };
  useEffect(() => {
    if (!activeOverlayPost) setSheetOpen(false);
  }, [activeOverlayPost]);

  /** Sync sheetOpen with panel height; only schedule to JS when threshold crosses to avoid 60fps setState during animation. */
  const setSheetOpenFromReaction = useCallback((open: boolean) => {
    setSheetOpen(open);
  }, []);
  useAnimatedReaction(
    () => panelHeightSv.value > 10,
    (isOpen, wasOpen) => {
      if (wasOpen !== undefined && isOpen !== wasOpen) {
        scheduleOnRN(setSheetOpenFromReaction, isOpen);
      }
    },
    [setSheetOpenFromReaction, panelHeightSv]
  );

  /** Fade absolute overlay bar in when sheet is closed, out when sheet opens or overlay closes. */
  useEffect(() => {
    if (!activeOverlayPost) {
      absoluteOverlayOpacitySv.value = withTiming(0, { duration: duration.instant });
      return;
    }
    if (sheetOpen) {
      absoluteOverlayOpacitySv.value = withTiming(0, { duration: duration.quick });
    } else {
      absoluteOverlayOpacitySv.value = withTiming(1, { duration: duration.quick });
    }
  }, [activeOverlayPost, sheetOpen, absoluteOverlayOpacitySv]);

  /** When true, the next time the panel content mounts it should start with content expanded (show more already done). */
  const [openWithContentExpanded, setOpenWithContentExpanded] = useState(false);

  /** Open sheet with spring for fluid feel. Pass { expandContent: true } to open with "show more" already expanded. */
  const openSheet = useCallback(
    (options?: { expandContent?: boolean }) => {
      if (options?.expandContent) setOpenWithContentExpanded(true);
      const snap60 = screenHeight * BOTTOM_PANEL_SHEET_SNAP_60_FRACTION;
      setPanelContentMinHeight(snap60);
      panelHeightSv.value = withSpring(snap60, {
        dampingRatio: 0.82,
        duration: 520,
      });
    },
    [screenHeight, setPanelContentMinHeight, panelHeightSv]
  );

  const onVerticalPagerSnap = useCallback(
    (index: number) => {
      if (!videoFeedLayouts?.length) return;
      const clamped = Math.max(0, Math.min(index, videoFeedLayouts.length - 1));
      const layout = videoFeedLayouts[clamped];
      if (layout) setVideoFeedIndex(clamped, layout);
    },
    [videoFeedLayouts, setVideoFeedIndex]
  );

  const rContainerStyle = useAnimatedStyle(() => ({
    pointerEvents: imageState.value === 'open' ? 'auto' : 'none',
    opacity: imageState.value === 'open' ? 1 : 0,
  }));

  const rImageStyle = useAnimatedStyle(() => {
    'worklet';
    const open = imageState.value === 'open';
    const closing = isClosing.value;
    const tw = closeTargetWidth.value;
    const th = closeTargetHeight.value;
    const w = imageWidth.value;
    const h = imageHeight.value;
    const panelOpen = panelHeightSv.value > 10;
    // Vertical feed + open + not closing: full-screen wrap centered on image so pager isn't clipped when swiping, and wrap still moves with drag (imageXCoord/imageYCoord drive center).
    if (isVerticalFeed && open && !closing) {
      const centerX = imageXCoord.value + w / 2;
      const centerY = imageYCoord.value + h / 2;
      return {
        left: centerX - screenWidth / 2,
        top: centerY - screenHeight / 2,
        width: screenWidth,
        height: screenHeight,
        opacity: 1,
        overflow: 'hidden' as const,
        transform: [{ scale: imageScale.value }],
      };
    }
    // When panel is open, image viewport shrinks with sheet — allow size to go below thumbnail. When closed, keep at least thumbnail size for dismiss animation.
    const viewW = panelOpen ? w : tw > 0 && th > 0 ? Math.max(w, tw) : w;
    const viewH = panelOpen ? h : tw > 0 && th > 0 ? Math.max(h, th) : h;
    return {
      left: imageXCoord.value,
      top: imageYCoord.value,
      width: viewW,
      height: viewH,
      opacity: open ? 1 : 0,
      overflow: 'hidden' as const,
      transform: [{ scale: imageScale.value }],
    };
  }, [
    isVerticalFeed,
    isClosing,
    closeTargetWidth,
    closeTargetHeight,
    panelHeightSv,
    screenWidth,
    screenHeight,
  ]);

  const rPagerScaleStyle = useAnimatedStyle(() => {
    'worklet';
    const ew = expandedWidthSv.value;
    const eh = expandedHeightSv.value;
    const tw = closeTargetWidth.value;
    const th = closeTargetHeight.value;
    const w = imageWidth.value;
    const h = imageHeight.value;
    const panelOpen = panelHeightSv.value > 10;
    const viewW = panelOpen ? w : tw > 0 && th > 0 ? Math.max(w, tw) : w;
    const viewH = panelOpen ? h : tw > 0 && th > 0 ? Math.max(h, th) : h;
    const scale = ew > 0 && eh > 0 ? Math.max(viewW / ew, viewH / eh) : 1;
    const translateX = (viewW - ew) / 2;
    const translateY = (viewH - eh) / 2;
    return {
      width: ew,
      height: eh,
      overflow: 'hidden' as const,
      transform: [{ translateX }, { translateY }, { scale }],
    };
  }, [
    expandedWidth,
    expandedHeight,
    expandedWidthSv,
    expandedHeightSv,
    closeTargetWidth,
    closeTargetHeight,
    panelHeightSv,
  ]);

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

  /**
   * Android backdrop: expo-blur without experimentalBlurMethod renders as a
   * weak translucent tint while paying animatedProps cost every frame, so the
   * backdrop is a solid black scrim instead. Its opacity is driven by the
   * same shared value as the blur intensity (0..DISMISS_BLUR_AT_REST →
   * 0..ANDROID_SCRIM_MAX_OPACITY) so drag-to-dismiss fades the scrim exactly
   * like the iOS blur.
   */
  const rAndroidScrimStyle = useAnimatedStyle(() => ({
    opacity: (blurIntensity.value / DISMISS_BLUR_AT_REST) * ANDROID_SCRIM_MAX_OPACITY,
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

  // Fade the pinned reply bar in/out with the drawer's openness — like the
  // link-embed action bar (likes/reposts/zaps). It's a separate, screen-anchored
  // element (never in the drawer's layout, so it can't reflow/jitter as the sheet
  // is dragged). At every normal snap the drawer is far taller than the bar, so
  // the bar stays fully opaque and motionless; only the final collapse fades it,
  // and the fade completes by the time the drawer shrinks to the bar's height so
  // the bar never pokes above the closing sheet.
  const rReplyBarFadeStyle = useAnimatedStyle(() => {
    const bar = replyBarHeightSv.value || 120;
    const t = (panelHeightSv.value - bar) / 100;
    return { opacity: Math.min(1, Math.max(0, t)) };
  });

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

  const closeRef = useLatestRef(close);
  /** Pass current pager index when multiple images so dismiss animates to the visible thumbnail. */
  const triggerClose = useCallback(
    (dismissedPageIndex?: number) => {
      imageScale.value = 1;
      const idx =
        typeof dismissedPageIndex === 'number'
          ? dismissedPageIndex
          : hasMultipleMedia
            ? Math.round(pagerOffsetSv.value)
            : 0;
      const fn = closeRef.current;
      if (fn) fn(idx);
    },
    [hasMultipleMedia, pagerOffsetSv, imageScale]
  );

  /**
   * Dismiss gesture by mode:
   * - image/single media: any direction
   * - multi-image (horizontal pager): vertical dismiss only
   * - vertical video feed (vertical pager): horizontal dismiss only
   */
  const pan = useMemo(
    () => {
      const gesture = Gesture.Pan().minDistance(DISMISS_MIN_DISTANCE);
      if (isVerticalFeed) {
        // Vertical pager owns Y axis; dismiss should activate only on horizontal intent.
        gesture
          .activeOffsetX([-DISMISS_ACTIVE_OFFSET_Y, DISMISS_ACTIVE_OFFSET_Y])
          .failOffsetY([-PAGER_ACTIVE_OFFSET_X, PAGER_ACTIVE_OFFSET_X]);
      } else if (hasMultipleMedia) {
        // Horizontal pager owns X axis; dismiss should activate only on vertical intent.
        gesture
          .activeOffsetY([-DISMISS_ACTIVE_OFFSET_Y, DISMISS_ACTIVE_OFFSET_Y])
          .failOffsetX([-PAGER_ACTIVE_OFFSET_X, PAGER_ACTIVE_OFFSET_X]);
      } else {
        gesture
          .activeOffsetX([-DISMISS_ACTIVE_OFFSET_Y, DISMISS_ACTIVE_OFFSET_Y])
          .activeOffsetY([-DISMISS_ACTIVE_OFFSET_Y, DISMISS_ACTIVE_OFFSET_Y]);
      }
      return gesture
        .onStart(() => {
          dismissPanActive.value = 1;
          scheduleOnRN(setDismissPanActive, true);
          panStartX.value = imageXCoord.value;
          panStartY.value = imageYCoord.value;
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
        .onFinalize((_event) => {
          const wasActive = dismissPanActive.value === 1;
          dismissPanActive.value = 0;
          const deltaX = imageXCoord.value - panStartX.value;
          const deltaY = imageYCoord.value - panStartY.value;
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          const ew = expandedWidthSv.value || expandedWidth;
          const eh = expandedHeightSv.value || expandedHeight;
          const threshold = Math.max(ew, eh) * DISMISS_THRESHOLD_FRACTION;
          const dismissed = distance > threshold;
          scheduleOnRN(setDismissPanActive, false);
          if (!wasActive) return;
          if (dismissed) {
            // Avoid transform-origin drift while closing; return animation should be driven by x/y/size only.
            imageScale.value = 1;
            cancelAnimation(pagerOffsetSv);
            pagerOffsetSv.value = Math.round(pagerOffsetSv.value);
            scheduleOnRN(triggerClose, Math.round(pagerOffsetSv.value));
          } else {
            imageScale.value = withTiming(1, IMAGE_OVERLAY_TIMING_CONFIG);
            openToCenter();
          }
        })
        .withRef(dismissPanRef);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values are stable refs
    [
      isVerticalFeed,
      hasMultipleMedia,
      expandedWidth,
      expandedHeight,
      expandedWidthSv,
      expandedHeightSv,
      screenWidth,
      setDismissPanActive,
      triggerClose,
      pagerOffsetSv,
      closeTargetPageX,
      closeTargetPageY,
      closeTargetWidth,
      closeTargetHeight,
    ]
  );

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
    if (pagerDragActiveRef.current || dismissPanActiveRef.current || sheetOpen) return;
    toggleOverlayUI();
  }, [toggleOverlayUI, sheetOpen]);
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

  // Unmount cleanup for the two cooldown timers above. Their callbacks only
  // touch refs so they're harmless after unmount, but cancelling on teardown
  // keeps the component from holding closures past its lifetime.
  useEffect(() => {
    return () => {
      if (clearDismissPanTimeoutRef.current) clearTimeout(clearDismissPanTimeoutRef.current);
      if (clearPagerDragTimeoutRef.current) clearTimeout(clearPagerDragTimeoutRef.current);
    };
  }, []);

  /** Max finger movement (px) for tap to count; prevents swipe-to-page from triggering toggle. */
  const TAP_MAX_DISTANCE = 12;

  /** Tap on image → toggle UI visibility. Tap on blur (not panel) → dismiss. Handled here so swipe-up pan can win over tap. */
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
          if (insideImage) {
            scheduleOnRN(handleImagePress);
            return;
          }
          const effectiveBottom = activeOverlayPost
            ? panelHeightSv.value > 0
              ? panelHeightSv.value
              : BOTTOM_PANEL_ABSOLUTE_OVERLAY_HEIGHT
            : BOTTOM_PANEL_SAFE_HEIGHT;
          const panelTopY = screenHeight - effectiveBottom;
          const insideBottomPanel = y >= panelTopY;
          if (insideBottomPanel) return;
          cancelAnimation(pagerOffsetSv);
          pagerOffsetSv.value = Math.round(pagerOffsetSv.value);
          scheduleOnRN(triggerClose, Math.round(pagerOffsetSv.value));
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worklet reads shared values
    [triggerClose, handleImagePress, screenHeight, activeOverlayPost, panelHeightSv, pagerOffsetSv]
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

  const panelScrollHandler = (e: { nativeEvent: { contentOffset: { y: number } } }) => {
    scrollOffsetYInPanel.value = e.nativeEvent.contentOffset.y;
  };

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
              if (finished && closeSheet) scheduleOnRN(setSheetOpenFromReaction, false);
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
  const dismissPanRef = useRef<GestureType | undefined>(undefined);
  const scrollAreaPan = Gesture.Pan()
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
          if (finished && closeSheet) scheduleOnRN(setSheetOpenFromReaction, false);
        }
      );
    })
    .withRef(scrollAreaPanRef);

  const triggerSwipeUpToNext = useCallback(() => {
    if (onSwipeUpToNextPost && openReplace) {
      onSwipeUpToNextPost(openReplace);
    }
  }, [onSwipeUpToNextPost, openReplace]);

  /** Run slide-off animation then trigger next post; used by both bar gesture and demo button. */
  const commitToNextPost = useCallback(() => {
    if (!onSwipeUpToNextPost || !openReplace) return;
    animatingToNextRef.current = true;
    const duration = SWIPE_UP_TRANSITION_DURATION_MS;
    swipeUpTranslateY.value = withTiming(
      -screenHeight,
      { duration, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) scheduleOnRN(triggerSwipeUpToNext);
      }
    );
  }, [onSwipeUpToNextPost, openReplace, screenHeight, swipeUpTranslateY, triggerSwipeUpToNext]);

  /** Vertical pager gesture for video feed, mirrors horizontal image pager behavior. */
  const verticalFeedPan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(isVerticalFeed && !sheetOpen)
        .activeOffsetY([-PAGER_ACTIVE_OFFSET_X, PAGER_ACTIVE_OFFSET_X])
        .failOffsetX([-PAGER_FAIL_OFFSET_Y, PAGER_FAIL_OFFSET_Y])
        .minDistance(PAGER_MIN_DISTANCE)
        .onStart(() => {
          if (imageState.value !== 'open') return;
          scheduleOnRN(setPagerDragActive, true);
          startVerticalPagerOffsetSv.value = verticalPagerOffsetSv.value;
        })
        .onChange((e) => {
          if (imageState.value !== 'open') return;
          const delta = -e.translationY / screenHeight;
          const next = startVerticalPagerOffsetSv.value + delta;
          verticalPagerOffsetSv.value = Math.max(0, Math.min(verticalFeedPageCount - 1, next));
        })
        .onEnd((e) => {
          if (imageState.value !== 'open') return;
          const delta = -e.translationY / screenHeight;
          const current = startVerticalPagerOffsetSv.value + delta;
          const velocity = -e.velocityY / screenHeight;
          const effective = current + velocity * PAGER_VELOCITY_WEIGHT;
          let snapTo = Math.max(0, Math.min(verticalFeedPageCount - 1, Math.round(effective)));
          const startIndex = Math.round(startVerticalPagerOffsetSv.value);
          if (
            velocity >= PAGER_FLICK_VELOCITY_THRESHOLD &&
            startIndex < verticalFeedPageCount - 1
          ) {
            snapTo = startIndex + 1;
          } else if (velocity <= -PAGER_FLICK_VELOCITY_THRESHOLD && startIndex > 0) {
            snapTo = startIndex - 1;
          }
          const didChangePage = snapTo !== startIndex;
          const initialVelocity = didChangePage
            ? 0
            : Math.max(-PAGER_VELOCITY_CLAMP, Math.min(PAGER_VELOCITY_CLAMP, velocity));
          const springConfig = didChangePage ? SNAP_SPRING_PAGE_CHANGE : SNAP_SPRING_SAME_PAGE;
          verticalPagerOffsetSv.value = withSpring(
            snapTo,
            {
              ...springConfig,
              velocity: initialVelocity,
            },
            (finished) => {
              if (finished && didChangePage) {
                scheduleOnRN(onVerticalPagerSnap, snapTo);
              }
            }
          );
          scheduleOnRN(setPagerDragActive, false);
        }),
    [
      isVerticalFeed,
      sheetOpen,
      imageState,
      setPagerDragActive,
      startVerticalPagerOffsetSv,
      verticalPagerOffsetSv,
      screenHeight,
      verticalFeedPageCount,
      onVerticalPagerSnap,
    ]
  );

  const rVerticalFeedPagerStyle = useAnimatedStyle(() => {
    const open = imageState.value === 'open';
    const closing = isClosing.value;
    const baseTranslateY = -verticalPagerOffsetSv.value * screenHeight;
    // When wrap is full-screen (vertical feed + open + !closing), center the fitted video in the viewport.
    const centerOffset =
      isVerticalFeed && open && !closing ? (screenHeight - expandedHeightSv.value) / 2 : 0;
    return {
      width: screenWidth,
      height: screenHeight * Math.max(1, verticalFeedPageCount),
      transform: [{ translateY: baseTranslateY + centerOffset }],
    };
  }, [
    isVerticalFeed,
    isClosing,
    imageState,
    screenWidth,
    screenHeight,
    verticalFeedPageCount,
    verticalPagerOffsetSv,
    expandedHeightSv,
  ]);

  /** Vertical bar pager fades with closeBtnOpacity so it doesn't sit on top of the shrinking image during close. */
  const rVerticalOverlayBarPagerStyle = useAnimatedStyle(
    () => ({
      opacity: closeBtnOpacity.value,
      width: screenWidth,
      height: screenHeight * Math.max(1, verticalFeedPageCount),
      transform: [{ translateY: -verticalPagerOffsetSv.value * screenHeight }],
    }),
    [closeBtnOpacity, screenWidth, screenHeight, verticalFeedPageCount, verticalPagerOffsetSv]
  );

  useEffect(() => {
    if (!animatingToNextRef.current) return;
    animatingToNextRef.current = false;
    swipeUpTranslateY.value = screenHeight;
    const duration = SWIPE_UP_TRANSITION_DURATION_MS;
    swipeUpTranslateY.value = withTiming(0, {
      duration,
      easing: Easing.out(Easing.cubic),
    });
  }, [activeUrl, activeOverlayPost?.event?.id, screenHeight, swipeUpTranslateY]);

  const rSwipeUpWrapperStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: swipeUpTranslateY.value }],
  }));

  /** Swipe up on the overlay bar: only when current media is video. */
  const overlayBarSwipeUp = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!!onSwipeUpToNextPost && isCurrentPageVideo)
        .activeOffsetY([SWIPE_UP_ACTIVE_OFFSET_Y, 1e6])
        .failOffsetX([-SWIPE_UP_FAIL_OFFSET_X, SWIPE_UP_FAIL_OFFSET_X])
        .minDistance(6)
        .onChange((e) => {
          'worklet';
          if (imageState.value !== 'open') return;
          const ty = e.translationY;
          const clamped = Math.max(-screenHeight, Math.min(0, ty));
          swipeUpTranslateY.value = clamped;
        })
        .onEnd((e) => {
          'worklet';
          if (imageState.value !== 'open') return;
          const ty = e.translationY;
          if (ty > -SWIPE_UP_CONFIRM_DISTANCE) {
            swipeUpTranslateY.value = withSpring(0, SNAP_SPRING_SAME_PAGE);
            return;
          }
          scheduleOnRN(commitToNextPost);
        }),
    [
      onSwipeUpToNextPost,
      isCurrentPageVideo,
      imageState,
      screenHeight,
      swipeUpTranslateY,
      commitToNextPost,
    ]
  );

  const horizontalPan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(hasMultipleMedia)
        .activeOffsetX([-PAGER_ACTIVE_OFFSET_X, PAGER_ACTIVE_OFFSET_X])
        .failOffsetY([-PAGER_FAIL_OFFSET_Y, PAGER_FAIL_OFFSET_Y])
        .minDistance(PAGER_MIN_DISTANCE)
        .onStart(() => {
          if (imageState.value !== 'open') return;
          scheduleOnRN(setPagerDragActive, true);
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
                scheduleOnRN(setActiveIndex, snapTo);
              }
            }
          );
          scheduleOnRN(setPagerDragActive, false);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values stable refs
    [
      hasMultipleMedia,
      expandedWidth,
      expandedWidthSv,
      maxPagerIndex,
      setActiveIndex,
      setPagerDragActive,
    ]
  );

  const composed = useMemo(() => {
    if (isVerticalFeed) {
      return Gesture.Exclusive(verticalFeedPan, pan, tapBackdrop);
    }
    return hasMultipleMedia
      ? Gesture.Exclusive(horizontalPan, pan, tapBackdrop)
      : Gesture.Exclusive(pan, tapBackdrop);
  }, [isVerticalFeed, hasMultipleMedia, verticalFeedPan, horizontalPan, pan, tapBackdrop]);

  /** Bar-area dismiss pan in vertical feed mode, using the same drag animation path as overlay dismiss. */
  const barDismissPan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(isVerticalFeed && !sheetOpen)
        .activeOffsetX([-DISMISS_ACTIVE_OFFSET_Y, DISMISS_ACTIVE_OFFSET_Y])
        .failOffsetY([-PAGER_ACTIVE_OFFSET_X, PAGER_ACTIVE_OFFSET_X])
        .minDistance(DISMISS_MIN_DISTANCE)
        .onStart(() => {
          dismissPanActive.value = 1;
          scheduleOnRN(setDismissPanActive, true);
          panStartX.value = imageXCoord.value;
          panStartY.value = imageYCoord.value;
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
        .onFinalize(() => {
          const wasActive = dismissPanActive.value === 1;
          dismissPanActive.value = 0;
          const deltaX = imageXCoord.value - panStartX.value;
          const deltaY = imageYCoord.value - panStartY.value;
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          const ew = expandedWidthSv.value || expandedWidth;
          const eh = expandedHeightSv.value || expandedHeight;
          const threshold = Math.max(ew, eh) * DISMISS_THRESHOLD_FRACTION;
          const dismissed = distance > threshold;
          scheduleOnRN(setDismissPanActive, false);
          if (!wasActive) return;
          if (dismissed) {
            // Avoid transform-origin drift while closing; return animation should be driven by x/y/size only.
            imageScale.value = 1;
            cancelAnimation(pagerOffsetSv);
            pagerOffsetSv.value = Math.round(pagerOffsetSv.value);
            scheduleOnRN(triggerClose, Math.round(pagerOffsetSv.value));
          } else {
            imageScale.value = withTiming(1, IMAGE_OVERLAY_TIMING_CONFIG);
            openToCenter();
          }
        }),
    [
      isVerticalFeed,
      sheetOpen,
      dismissPanActive,
      setDismissPanActive,
      panStartX,
      panStartY,
      imageXCoord,
      imageYCoord,
      closeBtnOpacity,
      imageState,
      screenWidth,
      imageScale,
      blurIntensity,
      expandedWidthSv,
      expandedHeightSv,
      expandedWidth,
      expandedHeight,
      pagerOffsetSv,
      triggerClose,
      openToCenter,
    ]
  );

  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: zIndex.overlay }]}
      pointerEvents={activeUrl ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, rSwipeUpWrapperStyle]}>
        <GestureDetector gesture={composed}>
          <AnimatedPressable style={[StyleSheet.absoluteFill, rContainerStyle]}>
            {/* box-none so taps on the blur fall through to the gesture (tapBackdrop → triggerClose); overlay root still blocks content behind */}
            <View style={StyleSheet.absoluteFill} pointerEvents="box-none" />
            {Platform.OS === 'android' ? (
              <Animated.View
                style={[StyleSheet.absoluteFill, overlayStyles.androidScrim, rAndroidScrimStyle]}
                pointerEvents="none"
              />
            ) : (
              <AnimatedBlurView
                tint="dark"
                style={StyleSheet.absoluteFill}
                animatedProps={backdropAnimatedProps}
                pointerEvents="none"
              />
            )}
            <Animated.View
              style={[
                overlayStyles.closeButton,
                { top: insets.top + CLOSE_BUTTON_TOP_OFFSET },
                rCloseBtnStyle,
              ]}>
              <Pressable onPress={() => triggerClose()} style={StyleSheet.absoluteFill}>
                <Icon name="material-symbols:close-rounded" size={22} color={INVARIANT_WHITE} />
              </Pressable>
            </Animated.View>
            {activeUrl ? (
              <Animated.View style={[overlayStyles.imageWrap, rImageStyle]}>
                {videoFeedLayouts && videoFeedLayouts.length > 1 ? (
                  <View style={[StyleSheet.absoluteFill]} pointerEvents="box-none">
                    <Animated.View style={[rVerticalFeedPagerStyle]} pointerEvents="none">
                      {videoFeedLayouts.map((layout, index) => (
                        <View
                          key={`${layout.url}-${index}`}
                          style={{
                            width: screenWidth,
                            height: screenHeight,
                          }}>
                          <MemoizedMediaPagerPage
                            url={layout.url}
                            mediaType={layout.mediaTypes?.[0] ?? 'image'}
                            index={0}
                            isActive={index === videoFeedLayoutIndex}
                            activeIndex={videoFeedLayoutIndex}
                            pagerIndex={index}
                            expandedWidthSv={expandedWidthSv}
                            expandedHeightSv={expandedHeightSv}
                          />
                        </View>
                      ))}
                    </Animated.View>
                  </View>
                ) : hasMultipleMedia ? (
                  <>
                    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                      <Animated.View style={rPagerScaleStyle}>
                        <Animated.View style={rPagerRowStyle}>
                          {activeUrls.map((url, i) => (
                            <MemoizedMediaPagerPage
                              key={url}
                              url={url}
                              mediaType={activeMediaTypes[i] ?? 'image'}
                              index={i}
                              isActive={i === activeIndex}
                              activeIndex={activeIndex}
                              expandedWidthSv={expandedWidthSv}
                              expandedHeightSv={expandedHeightSv}
                            />
                          ))}
                        </Animated.View>
                      </Animated.View>
                    </View>
                    <Animated.View
                      style={[overlayStyles.dotPager, rDotPagerStyle]}
                      pointerEvents="none">
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
                  <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                    {activeMediaTypes[0] === 'image' ? (
                      <Animated.View style={rPagerScaleStyle}>
                        <MemoizedMediaPagerPage
                          url={activeUrl}
                          mediaType="image"
                          index={0}
                          isActive={true}
                          activeIndex={0}
                          expandedWidthSv={expandedWidthSv}
                          expandedHeightSv={expandedHeightSv}
                        />
                      </Animated.View>
                    ) : (
                      <MemoizedMediaPagerPage
                        url={activeUrl}
                        mediaType={activeMediaTypes[0] ?? 'video'}
                        index={0}
                        isActive={true}
                        activeIndex={0}
                        expandedWidthSv={expandedWidthSv}
                        expandedHeightSv={expandedHeightSv}
                        containerWidthSv={imageWidth}
                        containerHeightSv={imageHeight}
                      />
                    )}
                  </View>
                )}
                {(isVerticalFeed || isCurrentPageVideo) && (
                  <View style={StyleSheet.absoluteFill} pointerEvents="auto" collapsable={false} />
                )}
              </Animated.View>
            ) : null}
          </AnimatedPressable>
        </GestureDetector>
        {isVerticalFeed && videoFeedLayouts && videoFeedLayouts.length > 1 ? (
          <Animated.View
            style={[overlayStyles.verticalOverlayBarPager, rVerticalOverlayBarPagerStyle]}
            pointerEvents="box-none">
            {videoFeedLayouts.map((layout, index) => {
              const pagePost =
                index === videoFeedLayoutIndex
                  ? (activeOverlayPost ?? layout.post ?? null)
                  : (layout.post ?? null);
              return (
                <View
                  key={`${layout.url}-${index}-bar`}
                  style={{ width: screenWidth, height: screenHeight }}
                  pointerEvents="box-none">
                  {pagePost ? (
                    <GestureDetector gesture={barDismissPan}>
                      <Animated.View
                        style={[
                          overlayStyles.absoluteOverlayBar,
                          rAbsoluteOverlayBarOpacityStyle,
                          {
                            bottom: 0,
                            minHeight: BOTTOM_PANEL_ABSOLUTE_OVERLAY_HEIGHT,
                            paddingBottom: insets.bottom + BOTTOM_PANEL_PADDING_BOTTOM_EXTRA,
                          },
                        ]}
                        pointerEvents={
                          sheetOpen || index !== videoFeedLayoutIndex || !activeOverlayPost
                            ? 'none'
                            : 'auto'
                        }>
                        <ImageOverlayAbsoluteBar
                          post={pagePost}
                          onOpenSheet={openSheet}
                          onRequestClose={() => triggerClose()}
                        />
                      </Animated.View>
                    </GestureDetector>
                  ) : null}
                </View>
              );
            })}
          </Animated.View>
        ) : activeOverlayPost ? (
          <GestureDetector gesture={overlayBarSwipeUp}>
            <Animated.View
              style={[
                overlayStyles.absoluteOverlayBar,
                rAbsoluteOverlayBarOpacityStyle,
                {
                  bottom: 0,
                  minHeight: BOTTOM_PANEL_ABSOLUTE_OVERLAY_HEIGHT,
                  paddingBottom: insets.bottom + BOTTOM_PANEL_PADDING_BOTTOM_EXTRA,
                },
              ]}
              pointerEvents={sheetOpen ? 'none' : 'auto'}>
              <ImageOverlayAbsoluteBar
                post={activeOverlayPost}
                onOpenSheet={openSheet}
                onRequestClose={() => triggerClose()}
              />
            </Animated.View>
          </GestureDetector>
        ) : null}
      </Animated.View>
      {activeOverlayPost ? (
        <Animated.View
          style={[
            overlayStyles.bottomPanel,
            rBottomPanelStyle,
            rBottomPanelLayoutStyle,
            {
              backgroundColor: panelSurface,
              // Reserve the pinned reply bar's height so the last metrics row
              // clears it. Constant, so it doesn't shift as the sheet resizes.
              paddingBottom: sheetOpen ? replyBarHeight : 0,
            },
          ]}
          pointerEvents="auto">
          <View style={overlayStyles.panelContentWrap} collapsable={false}>
            <GestureDetector gesture={handlePan}>
              <View style={overlayStyles.panelHandle} collapsable={false}>
                <View
                  style={[
                    overlayStyles.panelHandleBar,
                    { backgroundColor: opacity(panelForeground, 0.2) },
                  ]}
                />
              </View>
            </GestureDetector>
            <GestureDetector gesture={scrollAreaPan}>
              <View style={overlayStyles.panelScrollAndReplyWrap}>
                <GHScrollView
                  waitFor={scrollAreaPanRef}
                  onScroll={panelScrollHandler}
                  scrollEventThrottle={16}
                  style={overlayStyles.bottomPanelScroll}
                  contentContainerStyle={overlayStyles.bottomPanelScrollContent}
                  showsVerticalScrollIndicator={true}>
                  <View
                    onLayout={() => {
                      if (panelMinHeightReportedRef.current) return;
                      setPanelContentMinHeight(snap60Height);
                      panelMinHeightReportedRef.current = true;
                    }}
                    collapsable={false}>
                    <ImageOverlayBottomPanelContent
                      post={activeOverlayPost}
                      initialContentExpanded={openWithContentExpanded}
                      onConsumedExpand={() => setOpenWithContentExpanded(false)}
                      onRequestClose={() => triggerClose()}
                    />
                  </View>
                </GHScrollView>
              </View>
            </GestureDetector>
          </View>
        </Animated.View>
      ) : null}
      {/* The live reply composer — the SAME component as the thread's sticky reply
          bar. Pinned to the screen bottom above the drawer (zIndex.modal over the
          panel's zIndex.raised) and FADED in/out with the drawer's openness — like
          the link-embed action bar — so it never sits in the drawer's animating
          layout and can't reflow as the sheet is resized. It lifts with the
          keyboard itself (`insideOverlay`); expand / poll close the lightbox. */}
      {activeOverlayPost && sheetOpen ? (
        <Animated.View
          style={[StyleSheet.absoluteFill, { zIndex: zIndex.modal }, rReplyBarFadeStyle]}
          pointerEvents="box-none">
          <ThreadReplyBar
            targetEvent={activeOverlayPost.event}
            targetProfile={activeOverlayPost.profile ?? undefined}
            onExpand={() => triggerClose()}
            onHeightChange={handleReplyBarHeight}
            scopeId="overlay"
            insideOverlay
            bottomInset={safeBottom}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

/**
 * Renders the image overlay. iOS wraps in FullWindowOverlay so it appears
 * above the Expo Router tab bar and header (same-window, correct
 * coordinates). Android registers the overlay element into
 * <AndroidImageOverlayHost /> (mounted once in app/_layout.tsx):
 * react-native-screens falls back to a constrained plain View for
 * FullWindowOverlay there, and the previous transparent RN Modal was a
 * SEPARATE native window, so measureInWindow thumbnail rects (main-surface
 * coordinates) didn't match overlay coordinates and the open/dismiss morph
 * landed offset. The same-window host makes both coordinate spaces identical
 * by construction, and removes the Modal mount latency that ate the first
 * frames of the open morph plus the teardown flash on close. The root
 * GestureHandlerRootView in app/_layout.tsx covers the hosted element, and
 * the element carries its data via the explicit `ctx` prop, so no contexts
 * need re-providing.
 */
export function AnimatedImageOverlay() {
  const ctx = useImageOverlay();
  // Hooks stay unconditional (this component renders on every platform and
  // with ctx possibly null); platform/ctx branching lives in effect bodies
  // and the render path below.
  const ownerKey = useId();
  // Read the safe-area inset HERE, outside the FullWindowOverlay. Inside the
  // overlay, `useSafeAreaInsets().bottom` is inflated (~3x) — the overlay sits
  // in a separate native window that mis-reports the bottom inset — which padded
  // the reply bar far above the home indicator. This value is correct; pass it
  // down so the content and the reply bar anchor like the thread.
  const safeBottom = useSafeAreaInsets().bottom;
  const androidActive = Platform.OS === 'android' && ctx?.activeUrl != null;

  // While a media url is active, host the overlay element in the main window.
  // Re-registers whenever ctx identity changes so the hosted element always
  // sees fresh state; ownerKey scoping means one feed's teardown can't
  // clobber another feed's registration.
  useEffect(() => {
    if (!androidActive || !ctx) return;
    setAndroidOverlayNode(
      ownerKey,
      <Log name="AnimatedImageOverlay">
        <AnimatedImageOverlayContent ctx={ctx} safeBottom={safeBottom} />
      </Log>
    );
    return () => clearAndroidOverlayNode(ownerKey);
  }, [androidActive, ctx, ownerKey, safeBottom]);

  // Hardware back closes the overlay — replaces the old Modal onRequestClose.
  useEffect(() => {
    if (!androidActive || !ctx) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      ctx.close();
      return true;
    });
    return () => subscription.remove();
  }, [androidActive, ctx]);

  if (!ctx) return null;
  if (Platform.OS === 'android') return null;
  const content = <AnimatedImageOverlayContent ctx={ctx} safeBottom={safeBottom} />;
  if (Platform.OS === 'ios') {
    return (
      <Log name="AnimatedImageOverlay">
        <FullWindowOverlay>{content}</FullWindowOverlay>
      </Log>
    );
  }
  return <Log name="AnimatedImageOverlay">{content}</Log>;
}

const overlayStyles = StyleSheet.create({
  androidScrim: {
    backgroundColor: 'rgba(0,0,0,1)',
  },
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
    zIndex: zIndex.raised,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  verticalOverlayBarPager: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: zIndex.raised,
  },
  bottomPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: zIndex.raised,
    borderTopLeftRadius: BOTTOM_PANEL_SHEET_TOP_BORDER_RADIUS,
    borderTopRightRadius: BOTTOM_PANEL_SHEET_TOP_BORDER_RADIUS,
    overflow: 'hidden',
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
});
