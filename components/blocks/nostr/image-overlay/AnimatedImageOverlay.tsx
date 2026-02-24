/**
 * Fullscreen image overlay with blur, pan-to-dismiss, horizontal pager, and bottom sheet.
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
  cancelAnimation,
  Easing,
  interpolate,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Icon from 'assets/icons';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import type { ImageOverlayContextValue } from './types';
import { IMAGE_OVERLAY_TIMING_CONFIG, useImageOverlay } from './provider';
import { MemoizedPagerPage } from './PagerPage';
import { OverlayDot } from './PagerDots';
import {
  ImageOverlayBottomPanelContent,
  ImageOverlayBottomPanelReply,
  ImageOverlayAbsoluteBar,
  PANEL_BG,
} from './BottomPanel';
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
  BOTTOM_PANEL_PADDING_HORIZONTAL,
  BOTTOM_PANEL_SHEET_TOP_BORDER_RADIUS,
} from './config';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

function AnimatedImageOverlayContent({ ctx }: { ctx: ImageOverlayContextValue }) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { keys: nostrKeys } = useNostrKeysContext();
  const panelMinHeightReportedRef = useRef(false);

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
    closeTargetWidth,
    closeTargetHeight,
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

  const pagerOffsetSv = useSharedValue(activeIndex);
  const startPagerOffsetSv = useSharedValue(activeIndex);

  useEffect(() => {
    pagerOffsetSv.value = activeIndex;
  }, [activeIndex, pagerOffsetSv]);

  useEffect(() => {
    if (activeUrl) overlayUIVisible.value = 1;
  }, [activeUrl, overlayUIVisible]);

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

  const rImageStyle = useAnimatedStyle(() => {
    'worklet';
    const tw = closeTargetWidth.value;
    const th = closeTargetHeight.value;
    const w = imageWidth.value;
    const h = imageHeight.value;
    const panelOpen = panelHeightSv.value > 10;
    // When panel is open, image viewport shrinks with sheet — allow size to go below thumbnail. When closed, keep at least thumbnail size for dismiss animation.
    const viewW = panelOpen ? w : tw > 0 && th > 0 ? Math.max(w, tw) : w;
    const viewH = panelOpen ? h : tw > 0 && th > 0 ? Math.max(h, th) : h;
    return {
      left: imageXCoord.value,
      top: imageYCoord.value,
      width: viewW,
      height: viewH,
      opacity: imageState.value === 'open' ? 1 : 0,
      overflow: 'hidden' as const,
      transform: [{ scale: imageScale.value }],
    };
  }, [closeTargetWidth, closeTargetHeight, panelHeightSv]);

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

  const closeRef = useRef(close);
  closeRef.current = close;
  /** Pass current pager index when multiple images so dismiss animates to the visible thumbnail. */
  const triggerClose = useCallback(
    (dismissedPageIndex?: number) => {
      imageScale.value = 1;
      const idx =
        typeof dismissedPageIndex === 'number'
          ? dismissedPageIndex
          : hasMultipleImages
            ? Math.round(pagerOffsetSv.value)
            : 0;
      const fn = closeRef.current;
      if (fn) fn(idx);
    },
    [hasMultipleImages, pagerOffsetSv, imageScale]
  );

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
          runOnJS(setDismissPanActive)(false);
          imageScale.value = withTiming(1, IMAGE_OVERLAY_TIMING_CONFIG);
          if (!wasActive) return;
          if (dismissed) {
            cancelAnimation(pagerOffsetSv);
            pagerOffsetSv.value = Math.round(pagerOffsetSv.value);
            runOnJS(triggerClose)(Math.round(pagerOffsetSv.value));
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
      triggerClose,
      pagerOffsetSv,
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
          cancelAnimation(pagerOffsetSv);
          pagerOffsetSv.value = Math.round(pagerOffsetSv.value);
          runOnJS(triggerClose)(Math.round(pagerOffsetSv.value));
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worklet reads shared values
    [triggerClose, screenHeight, activeOverlayPost, panelHeightSv, pagerOffsetSv]
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
              overlayStyles.closeButton,
              { top: insets.top + CLOSE_BUTTON_TOP_OFFSET },
              rCloseBtnStyle,
            ]}>
            <Pressable onPress={() => triggerClose()} style={StyleSheet.absoluteFill}>
              <Icon name="material-symbols:close-rounded" size={22} color="#fff" />
            </Pressable>
          </Animated.View>
          {activeUrl ? (
            <Animated.View style={[overlayStyles.imageWrap, rImageStyle]}>
              {hasMultipleImages ? (
                <>
                  <Pressable style={StyleSheet.absoluteFill} onPress={handleImagePress}>
                    <Animated.View style={rPagerScaleStyle}>
                      <Animated.View style={rPagerRowStyle}>
                        {activeUrls.map((url, i) => (
                          <MemoizedPagerPage
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
            overlayStyles.absoluteOverlayBar,
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
            overlayStyles.bottomPanel,
            rBottomPanelStyle,
            rBottomPanelLayoutStyle,
            {
              paddingBottom: insets.bottom + BOTTOM_PANEL_PADDING_BOTTOM_EXTRA,
            },
          ]}
          pointerEvents="auto">
          <View style={overlayStyles.panelContentWrap} collapsable={false}>
            <GestureDetector gesture={handlePan}>
              <View style={overlayStyles.panelHandle} collapsable={false}>
                <View style={overlayStyles.panelHandleBar} />
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
                    />
                  </View>
                </GHScrollView>
                <View style={overlayStyles.bottomPanelReplyWrap} collapsable={false}>
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

const overlayStyles = StyleSheet.create({
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
  bottomPanelReplyWrap: {
    paddingHorizontal: BOTTOM_PANEL_PADDING_HORIZONTAL,
    paddingTop: 8,
    paddingBottom: 0,
  },
});
