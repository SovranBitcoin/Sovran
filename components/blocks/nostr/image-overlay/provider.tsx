/**
 * Provider for expandable image overlay (threads-style).
 * Tracks scroll offset and exposes open/close + shared values for the overlay.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  cancelAnimation,
  Easing,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { useScrollViewOffset } from '@/hooks/useScrollViewOffset';
import type { EngagementViewState } from '@/hooks/useNostrEngagement';
import type { NoteMetrics } from '../shared';
import {
  BOTTOM_PANEL_STIFF_DURATION_MS,
  CLEAR_URL_DELAY_MS,
  CLOSE_BLUR_AND_BTN_DURATION_MS,
  CLOSE_SPRING,
  OPEN_START_DELAY_MS,
  THUMB_BLUR_DISTANCE_FACTOR,
  THUMB_BLUR_MAX_INTENSITY,
} from './config';
import type {
  ImageOverlayPost,
  ImageOverlayLayout,
  ThumbnailLayout,
  ImageOverlayContextValue,
} from './types';

const TIMING_CONFIG = {
  duration: CLOSE_BLUR_AND_BTN_DURATION_MS,
  easing: Easing.out(Easing.cubic),
};

// Types re-exported from ./types for backward compatibility
export type {
  ImageOverlayPost,
  ImageOverlayLayout,
  ThumbnailLayout,
  ImageOverlayContextValue,
} from './types';

/** State that changes on open/close; separate context to keep actions context stable. */
type ImageOverlayStateValue = Pick<
  ImageOverlayContextValue,
  'activeUrl' | 'activeAspectRatio' | 'activeUrls' | 'activeIndex' | 'activeOverlayPost'
>;

/** Callbacks + shared values; stable across open/close so consumers don't re-render unnecessarily. */
type ImageOverlayActionsValue = Omit<
  ImageOverlayContextValue,
  | 'activeUrl'
  | 'activeAspectRatio'
  | 'activeUrls'
  | 'activeIndex'
  | 'activeOverlayPost'
  | 'expandedWidth'
  | 'expandedHeight'
> & {
  screenWidth: number;
  screenHeight: number;
  /** Image viewport height (screenHeight - top inset); used by hook for expandedHeight. */
  expandedHeightFromContext: number;
};

const ImageOverlayStateContext = createContext<ImageOverlayStateValue | null>(null);
const ImageOverlayActionsContext = createContext<ImageOverlayActionsValue | null>(null);

/** Largest size that fits the screen without overflowing (preserves aspect ratio). Exported for hook. */
export function computeExpandedSize(
  screenWidth: number,
  screenHeight: number,
  aspectRatio: number
): { width: number; height: number } {
  const fitByWidth = screenWidth / aspectRatio <= screenHeight;
  if (fitByWidth) {
    return { width: screenWidth, height: screenWidth / aspectRatio };
  }
  return { width: screenHeight * aspectRatio, height: screenHeight };
}

export type ImageOverlayProviderProps = {
  children: React.ReactNode;
  /** When provided, overlay panel shows live metrics (optimistic counts) for the active post. */
  getDisplayMetrics?: (eventId: string) => NoteMetrics;
  /** When provided, overlay panel shows live engagement (liked, reposted, pending) for the active post. */
  getEngagementState?: (eventId: string) => EngagementViewState;
};

export function ImageOverlayProvider({
  children,
  getDisplayMetrics,
  getEngagementState,
}: ImageOverlayProviderProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { scrollOffsetY, scrollHandler } = useScrollViewOffset();
  const safeTop = insets.top;
  const safeBottom = insets.bottom;
  /** Image viewport: below notch only (no bottom inset) so image extends to screen bottom. */
  const imageViewportHeight = screenHeight - safeTop;

  const [activeUrls, setActiveUrls] = useState<string[]>([]);
  const [activeIndex, setActiveIndexState] = useState(0);
  const activeUrl = activeUrls.length > 0 ? (activeUrls[activeIndex] ?? activeUrls[0]) : null;
  const [activeAspectRatio, setActiveAspectRatio] = useState(16 / 9);
  const [activeOverlayPost, setActiveOverlayPost] = useState<ImageOverlayPost | null>(null);

  const setActiveIndex = useCallback((index: number) => {
    setActiveIndexState((prev) => (index === prev ? prev : index));
  }, []);

  const registerThumbnailLayout = useCallback(
    (url: string, layout: ThumbnailLayout, options?: { eventId?: string; imageIndex?: number }) => {
      const key =
        options?.eventId != null && options?.imageIndex != null
          ? `${options.eventId}-${options.imageIndex}`
          : url;
      thumbnailLayoutsRef.current[key] = layout;
    },
    []
  );

  const scrollOffsetAtOpen = useSharedValue(0);
  const imageState = useSharedValue<'open' | 'close'>('close');
  const imageXCoord = useSharedValue(0);
  const imageYCoord = useSharedValue(0);
  const imageWidth = useSharedValue(0);
  const imageHeight = useSharedValue(0);
  const blurIntensity = useSharedValue(0);
  const closeBtnOpacity = useSharedValue(0);

  const closeTargetPageX = useSharedValue(0);
  const closeTargetPageY = useSharedValue(0);
  const closeTargetWidth = useSharedValue(0);
  const closeTargetHeight = useSharedValue(0);

  const centerXSv = useSharedValue(0);
  const centerYSv = useSharedValue(0);
  const expandedWidthSv = useSharedValue(0);
  const expandedHeightSv = useSharedValue(0);
  const closeSpringsDoneCount = useSharedValue(0);
  const isClosing = useSharedValue(false);

  const panelHeightSv = useSharedValue(0);
  const panelContentMinHeightSv = useSharedValue(0);
  const safeTopSv = useSharedValue(0);
  const safeBottomSv = useSharedValue(0);
  const aspectRatioSv = useSharedValue(16 / 9);
  const hasPanelSv = useSharedValue(0);
  /** 1 while image is animating from thumbnail to expanded on open-with-panel; reaction skips so it doesn't overwrite. */
  const openAnimationInProgressSv = useSharedValue(0);
  const screenWidthSv = useSharedValue(0);
  const screenHeightSv = useSharedValue(0);

  const setPanelHeight = useCallback(
    (height: number) => {
      panelHeightSv.value = withTiming(height, {
        duration: BOTTOM_PANEL_STIFF_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      });
    },
    [panelHeightSv]
  );

  const setPanelContentMinHeight = useCallback(
    (height: number) => {
      panelContentMinHeightSv.value = height;
    },
    [panelContentMinHeightSv]
  );

  useEffect(() => {
    safeTopSv.value = safeTop;
    safeBottomSv.value = safeBottom;
  }, [safeTop, safeBottom, safeTopSv, safeBottomSv]);

  const thumbnailLayoutsRef = useRef<Record<string, ThumbnailLayout>>({});
  /** Layout of the image we opened from (tap-time). Used for dismiss so we don't get overwritten by registerThumbnailLayout from other cards. */
  const openSessionInitialLayoutRef = useRef<ThumbnailLayout | null>(null);
  const openSessionInitialIndexRef = useRef(0);
  /** Snapshot of thumbnail layouts for every pager index at open() time. Prevents wrong height when dismissing from page 2/3 (ref would otherwise be overwritten by other cards). */
  const openSessionLayoutsByIndexRef = useRef<(ThumbnailLayout | null)[]>([]);

  /** 0 when overlay is aligned with thumbnail, max when displaced (open/drag). Drives thumbnail blur. */
  const thumbnailBlurIntensity = useDerivedValue(() => {
    'worklet';
    if (imageState.value === 'close') return 0;
    const cx = imageXCoord.value + imageWidth.value / 2;
    const cy = imageYCoord.value + imageHeight.value / 2;
    const tx = closeTargetPageX.value + closeTargetWidth.value / 2;
    const ty = closeTargetPageY.value + closeTargetHeight.value / 2;
    const positionDist = Math.sqrt((cx - tx) ** 2 + (cy - ty) ** 2);
    const thumbDiag = Math.sqrt(closeTargetWidth.value ** 2 + closeTargetHeight.value ** 2) || 1;
    const positionD = Math.min(1, positionDist / (thumbDiag * THUMB_BLUR_DISTANCE_FACTOR));
    const tw = closeTargetWidth.value;
    const expandedW = expandedWidthSv.value;
    const sizeD =
      expandedW > tw ? Math.min(1, Math.max(0, (imageWidth.value - tw) / (expandedW - tw))) : 0;
    const displacement = Math.max(positionD, sizeD);
    return Math.round(displacement * THUMB_BLUR_MAX_INTENSITY);
  });

  const clearUrlDelayed = useCallback(() => {
    setActiveOverlayPost(null);
    hasPanelSv.value = 0;
    openAnimationInProgressSv.value = 0;
    panelHeightSv.value = 0;
    panelContentMinHeightSv.value = 0;
    openSessionInitialLayoutRef.current = null;
    openSessionLayoutsByIndexRef.current = [];
    setTimeout(() => setActiveUrls([]), CLEAR_URL_DELAY_MS);
  }, [hasPanelSv, openAnimationInProgressSv, panelHeightSv, panelContentMinHeightSv]);

  const finishClose = useCallback(() => {
    imageState.value = 'close';
    isClosing.value = false;
    clearUrlDelayed();
  }, [clearUrlDelayed, imageState, isClosing]);

  const screenCenterX = screenWidth / 2;
  /** Center Y for image when no panel: center of viewport (below notch, to screen bottom). */
  const screenCenterY = safeTop + imageViewportHeight / 2;

  const openToCenter = useCallback(() => {
    'worklet';
    const blurTiming = {
      duration: CLOSE_BLUR_AND_BTN_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    };
    const cx = centerXSv.value;
    const cy = centerYSv.value;
    const ew = expandedWidthSv.value;
    const eh = expandedHeightSv.value;
    blurIntensity.value = withTiming(100, blurTiming);
    // Delay expand so overlay can mount and paint thumbnail before animating; use same spring as dismiss
    imageXCoord.value = withDelay(OPEN_START_DELAY_MS, withSpring(cx - ew / 2, CLOSE_SPRING));
    imageYCoord.value = withDelay(OPEN_START_DELAY_MS, withSpring(cy - eh / 2, CLOSE_SPRING));
    imageWidth.value = withDelay(OPEN_START_DELAY_MS, withSpring(ew, CLOSE_SPRING));
    imageHeight.value = withDelay(OPEN_START_DELAY_MS, withSpring(eh, CLOSE_SPRING));
    closeBtnOpacity.value = withDelay(
      OPEN_START_DELAY_MS + CLOSE_BLUR_AND_BTN_DURATION_MS,
      withTiming(1)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worklet captures shared-value refs
  }, []);

  /** Only blur + close button (and thus dots/panel). Used when opening with panel so image stays at thumbnail until startOpenPanelImageAnimation. */
  const openRevealUi = useCallback(() => {
    'worklet';
    const blurTiming = {
      duration: CLOSE_BLUR_AND_BTN_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    };
    blurIntensity.value = withTiming(100, blurTiming);
    closeBtnOpacity.value = withDelay(
      OPEN_START_DELAY_MS + CLOSE_BLUR_AND_BTN_DURATION_MS,
      withTiming(1)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worklet captures shared-value refs
  }, []);

  /** Worklet: animate image from thumbnail to current centerYSv/expandedWidthSv/expandedHeightSv (final position). Uses same spring as dismiss. */
  const openPanelImageToFinal = useCallback(() => {
    'worklet';
    openAnimationInProgressSv.value = 1;
    const cx = centerXSv.value;
    const cy = centerYSv.value;
    const ew = expandedWidthSv.value;
    const eh = expandedHeightSv.value;
    const targetX = cx - ew / 2;
    const targetY = cy - eh / 2;
    imageXCoord.value = withSpring(targetX, CLOSE_SPRING);
    imageYCoord.value = withSpring(targetY, CLOSE_SPRING);
    imageWidth.value = withSpring(ew, CLOSE_SPRING);
    imageHeight.value = withSpring(eh, CLOSE_SPRING, () => {
      'worklet';
      openAnimationInProgressSv.value = 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worklet captures shared-value refs
  }, []);

  const startOpenPanelImageAnimation = useCallback(
    (minPanelHeight: number) => {
      // openAnimationInProgressSv already set to 1 in open() when hasPanel so reaction skips from first frame
      const availableHeight = imageViewportHeight - minPanelHeight;
      // Max viewport so each image fits independently (contentFit="contain")
      const expW = screenWidth;
      const expH = availableHeight;
      const centerY = safeTop + availableHeight / 2;
      centerYSv.value = centerY;
      expandedWidthSv.value = expW;
      expandedHeightSv.value = expH;
      aspectRatioSv.value = activeAspectRatio;
      scheduleOnUI(openPanelImageToFinal);
    },
    [
      screenWidth,
      safeTop,
      imageViewportHeight,
      activeAspectRatio,
      centerYSv,
      expandedWidthSv,
      expandedHeightSv,
      aspectRatioSv,
      openPanelImageToFinal,
    ]
  );

  const open = useCallback(
    (layout: ImageOverlayLayout) => {
      safeTopSv.value = safeTop;
      safeBottomSv.value = safeBottom;
      const aspectRatio = layout.aspectRatio ?? layout.width / layout.height;
      const hasPanel = !!layout.post;
      // When hasPanel we start with sheet closed: image centered in viewport (below notch to bottom); absolute overlay sits on top.
      const availableHeight = imageViewportHeight;
      // Max viewport so each image fits independently (contentFit="contain"); not tied to clicked image aspect ratio
      const expW = screenWidth;
      const expH = availableHeight;
      const imageAreaCenterY = safeTop + availableHeight / 2;

      const urls = layout.urls && layout.urls.length > 1 ? layout.urls : [layout.url];
      const initialIndex = Math.min(layout.initialIndex ?? 0, Math.max(0, urls.length - 1));
      setActiveUrls(urls);
      setActiveIndexState(initialIndex);
      setActiveAspectRatio(aspectRatio);
      setActiveOverlayPost(layout.post ?? null);

      screenWidthSv.value = screenWidth;
      screenHeightSv.value = screenHeight;
      aspectRatioSv.value = aspectRatio;
      if (hasPanel) {
        hasPanelSv.value = 1;
        panelHeightSv.value = 0; // Sheet closed initially; absolute overlay only
        // Block panel reaction until startOpenPanelImageAnimation runs
        openAnimationInProgressSv.value = 1;
      } else {
        hasPanelSv.value = 0;
        panelHeightSv.value = 0;
      }

      scrollOffsetAtOpen.value = scrollOffsetY.value;
      closeTargetPageX.value = layout.pageX;
      closeTargetPageY.value = layout.pageY;
      closeTargetWidth.value = layout.width;
      closeTargetHeight.value = layout.height;
      const eventId = layout.post?.event?.id;
      const keyForIndex = (i: number, u: string) => (eventId != null ? `${eventId}-${i}` : u);
      thumbnailLayoutsRef.current[keyForIndex(initialIndex, layout.url)] = {
        pageX: layout.pageX,
        pageY: layout.pageY,
        width: layout.width,
        height: layout.height,
      };
      const tapLayout: ThumbnailLayout = {
        pageX: layout.pageX,
        pageY: layout.pageY,
        width: layout.width,
        height: layout.height,
      };
      openSessionInitialLayoutRef.current = tapLayout;
      openSessionInitialIndexRef.current = initialIndex;
      // Snapshot layout per pager index at open time; use eventId+index so we use this post's thumbnails, not another card's (same URL).
      openSessionLayoutsByIndexRef.current = urls.map((url, i) =>
        i === initialIndex ? tapLayout : (thumbnailLayoutsRef.current[keyForIndex(i, url)] ?? null)
      );

      // Capture layout values for the UI-thread worklet.
      const fromX = layout.pageX;
      const fromY = layout.pageY;
      const fromW = layout.width;
      const fromH = layout.height;
      const toCenterY = hasPanel ? imageAreaCenterY : screenCenterY;

      // Run cancel + initial position + animation atomically on the UI thread.
      // Previously these were split across JS (cancelAnimation, direct set) and
      // UI (scheduleOnUI(openToCenter)) threads, causing a race where the cancel
      // message could arrive after the animation started, killing it instantly.
      scheduleOnUI(() => {
        'worklet';
        // 1. Cancel any in-flight animations from a previous close/pan-dismiss.
        cancelAnimation(imageXCoord);
        cancelAnimation(imageYCoord);
        cancelAnimation(imageWidth);
        cancelAnimation(imageHeight);
        cancelAnimation(blurIntensity);
        cancelAnimation(closeBtnOpacity);
        cancelAnimation(panelHeightSv);

        // 2. Set starting position (thumbnail rect) — must happen after cancel.
        closeSpringsDoneCount.value = 0;
        isClosing.value = false;
        imageState.value = 'open';
        imageXCoord.value = fromX;
        imageYCoord.value = fromY;
        imageWidth.value = fromW;
        imageHeight.value = fromH;

        centerXSv.value = screenCenterX;
        centerYSv.value = toCenterY;
        expandedWidthSv.value = expW;
        expandedHeightSv.value = expH;

        // 3. Start the expand animation — runs in the same UI frame.
        if (hasPanel) {
          openRevealUi();
        } else {
          openToCenter();
        }
      });

      // For panel mode, delay image-to-final so overlay can paint thumbnail first.
      if (hasPanel) {
        setTimeout(() => startOpenPanelImageAnimation(0), OPEN_START_DELAY_MS);
      }
    },
    [
      screenWidth,
      screenHeight,
      safeTop,
      safeBottom,
      imageViewportHeight,
      safeTopSv,
      safeBottomSv,
      screenCenterX,
      screenCenterY,
      scrollOffsetY,
      scrollOffsetAtOpen,
      closeTargetPageX,
      closeTargetPageY,
      closeTargetWidth,
      closeTargetHeight,
      centerXSv,
      centerYSv,
      expandedWidthSv,
      expandedHeightSv,
      closeSpringsDoneCount,
      imageState,
      imageXCoord,
      imageYCoord,
      imageWidth,
      imageHeight,
      blurIntensity,
      closeBtnOpacity,
      isClosing,
      openToCenter,
      openRevealUi,
      startOpenPanelImageAnimation,
      hasPanelSv,
      openAnimationInProgressSv,
      panelHeightSv,
      aspectRatioSv,
      screenWidthSv,
      screenHeightSv,
    ]
  );

  /** Worklet: run close animation to current closeTarget* (call after syncing targets from dismiss index). */
  const closeAnimationWorklet = useCallback(() => {
    'worklet';
    if (imageState.value !== 'open') return;
    if (isClosing.value) return;
    isClosing.value = true;

    cancelAnimation(imageXCoord);
    cancelAnimation(imageYCoord);
    cancelAnimation(imageWidth);
    cancelAnimation(imageHeight);

    const x = closeTargetPageX.value;
    const scrollY = scrollOffsetY.value;
    const scrollAtOpen = scrollOffsetAtOpen.value;
    const y = closeTargetPageY.value - scrollY + scrollAtOpen;
    const w = closeTargetWidth.value;
    const h = closeTargetHeight.value;

    closeSpringsDoneCount.value = 0;

    const maybeFinishClose = () => {
      'worklet';
      closeSpringsDoneCount.value += 1;
      if (closeSpringsDoneCount.value === 4) {
        imageState.value = 'close';
        scheduleOnRN(finishClose);
      }
    };

    blurIntensity.value = withTiming(0, {
      duration: CLOSE_BLUR_AND_BTN_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    });
    imageXCoord.value = withSpring(x, CLOSE_SPRING, () => {
      'worklet';
      imageXCoord.value = x;
      maybeFinishClose();
    });
    imageYCoord.value = withSpring(y, CLOSE_SPRING, () => {
      'worklet';
      imageYCoord.value = y;
      maybeFinishClose();
    });
    imageWidth.value = withSpring(w, CLOSE_SPRING, () => {
      'worklet';
      imageWidth.value = w;
      maybeFinishClose();
    });
    imageHeight.value = withSpring(h, CLOSE_SPRING, () => {
      'worklet';
      imageHeight.value = h;
      maybeFinishClose();
    });
    closeBtnOpacity.value = withTiming(0, {
      duration: CLOSE_BLUR_AND_BTN_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [
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
    scrollOffsetY,
    scrollOffsetAtOpen,
    closeSpringsDoneCount,
    blurIntensity,
    closeBtnOpacity,
    finishClose,
  ]);

  /**
   * Close overlay: animates image back to thumbnail.
   * When multiple images, pass the current pager index so we dismiss to the visible image's thumbnail
   * (activeIndex can lag behind the pager, so we use the index passed from the overlay).
   */
  const close = useCallback(
    (dismissedPageIndex?: number) => {
      if (activeUrls.length > 1 && typeof dismissedPageIndex === 'number') {
        const eventId = activeOverlayPost?.event?.id;
        const url = activeUrls[dismissedPageIndex];
        const refKey = eventId != null ? `${eventId}-${dismissedPageIndex}` : url;
        const layout =
          openSessionLayoutsByIndexRef.current[dismissedPageIndex] ??
          (url ? thumbnailLayoutsRef.current[refKey] : undefined);
        if (layout) {
          closeTargetPageX.value = layout.pageX;
          closeTargetPageY.value = layout.pageY;
          closeTargetWidth.value = layout.width;
          closeTargetHeight.value = layout.height;
        }
      }
      scheduleOnUI(closeAnimationWorklet);
    },
    [
      activeUrls,
      activeOverlayPost?.event?.id,
      closeTargetPageX,
      closeTargetPageY,
      closeTargetWidth,
      closeTargetHeight,
      closeAnimationWorklet,
    ]
  );

  useEffect(() => {
    if (activeUrls.length <= 1) return;
    const url = activeUrls[activeIndex];
    const eventId = activeOverlayPost?.event?.id;
    const refKey = eventId != null ? `${eventId}-${activeIndex}` : url;
    let sessionLayoutByIndex = openSessionLayoutsByIndexRef.current[activeIndex] ?? null;
    const refLayout = url ? thumbnailLayoutsRef.current[refKey] : undefined;
    // If we had no snapshot for this index (e.g. other image hadn't registered at open()), use ref and backfill (same post key so we don't use another card's layout).
    if (!sessionLayoutByIndex && refLayout) {
      openSessionLayoutsByIndexRef.current[activeIndex] = refLayout;
      sessionLayoutByIndex = refLayout;
    }
    const layout = sessionLayoutByIndex ?? refLayout;
    if (layout) {
      closeTargetPageX.value = layout.pageX;
      closeTargetPageY.value = layout.pageY;
      closeTargetWidth.value = layout.width;
      closeTargetHeight.value = layout.height;
    }
  }, [
    activeIndex,
    activeUrls,
    activeOverlayPost?.event?.id,
    closeTargetPageX,
    closeTargetPageY,
    closeTargetWidth,
    closeTargetHeight,
  ]);

  /** When the feed supplies getters, show live metrics/engagement so overlay updates on like/repost. */
  const effectiveOverlayPost = useMemo((): ImageOverlayPost | null => {
    if (!activeOverlayPost) return null;
    if (getDisplayMetrics && getEngagementState) {
      const eventId = activeOverlayPost.event.id;
      return {
        ...activeOverlayPost,
        metrics: getDisplayMetrics(eventId),
        liked: getEngagementState(eventId).liked,
        reposted: getEngagementState(eventId).reposted,
        likePending: getEngagementState(eventId).likePending,
        repostPending: getEngagementState(eventId).repostPending,
        likePendingDirection: getEngagementState(eventId).likePendingDirection,
        repostPendingDirection: getEngagementState(eventId).repostPendingDirection,
      };
    }
    return activeOverlayPost;
  }, [activeOverlayPost, getDisplayMetrics, getEngagementState]);

  const stateValue = useMemo<ImageOverlayStateValue>(
    () => ({
      activeUrl,
      activeAspectRatio,
      activeUrls,
      activeIndex,
      activeOverlayPost: effectiveOverlayPost,
    }),
    [activeUrl, activeAspectRatio, activeUrls, activeIndex, effectiveOverlayPost]
  );

  const actionsValue = useMemo<ImageOverlayActionsValue>(() => {
    return {
      scrollHandler,
      scrollOffsetY,
      open,
      close,
      openToCenter,
      registerThumbnailLayout,
      setPanelHeight,
      setPanelContentMinHeight,
      startOpenPanelImageAnimation,
      setActiveIndex,
      imageState,
      imageXCoord,
      imageYCoord,
      imageWidth,
      imageHeight,
      closeTargetWidth,
      closeTargetHeight,
      blurIntensity,
      thumbnailBlurIntensity,
      closeBtnOpacity,
      expandedWidthSv,
      expandedHeightSv,
      panelHeightSv,
      panelContentMinHeightSv,
      screenWidth,
      screenHeight,
      expandedHeightFromContext: imageViewportHeight,
    };
  }, [
    scrollHandler,
    scrollOffsetY,
    open,
    close,
    openToCenter,
    registerThumbnailLayout,
    setPanelHeight,
    setPanelContentMinHeight,
    startOpenPanelImageAnimation,
    setActiveIndex,
    imageState,
    imageXCoord,
    imageYCoord,
    imageWidth,
    imageHeight,
    closeTargetWidth,
    closeTargetHeight,
    blurIntensity,
    thumbnailBlurIntensity,
    closeBtnOpacity,
    expandedWidthSv,
    expandedHeightSv,
    panelHeightSv,
    panelContentMinHeightSv,
    screenWidth,
    screenHeight,
    imageViewportHeight,
  ]);

  useAnimatedReaction(
    () => panelHeightSv.value,
    (panelH) => {
      if (hasPanelSv.value !== 1) return;
      if (openAnimationInProgressSv.value === 1) return;
      if (isClosing.value) return;
      const sh = screenHeightSv.value;
      const sw = screenWidthSv.value;
      const topInset = safeTopSv.value;
      const bottomInset = safeBottomSv.value;
      // Only shrink image when the sheet would collide with it (sheet top above content).
      const effectiveBottom = panelH > bottomInset ? panelH : 0;
      const availableHeight = sh - topInset - effectiveBottom;
      const centerY = topInset + availableHeight / 2;
      // Max viewport: full width and height so each image can fit independently (contentFit="contain")
      const expW = sw;
      const expH = availableHeight;
      expandedWidthSv.value = expW;
      expandedHeightSv.value = expH;
      centerYSv.value = centerY;
      const cx = centerXSv.value;
      const imageX = cx - expW / 2;
      const imageY = centerY - expH / 2;
      // Direct assignment so image follows panel without restarting springs every frame (avoids jitter)
      imageXCoord.value = imageX;
      imageYCoord.value = imageY;
      imageWidth.value = expW;
      imageHeight.value = expH;
    }
  );

  return (
    <ImageOverlayStateContext.Provider value={stateValue}>
      <ImageOverlayActionsContext.Provider value={actionsValue}>
        {children}
      </ImageOverlayActionsContext.Provider>
    </ImageOverlayStateContext.Provider>
  );
}

export function useImageOverlay(): ImageOverlayContextValue | null {
  const state = useContext(ImageOverlayStateContext);
  const actions = useContext(ImageOverlayActionsContext);
  return useMemo((): ImageOverlayContextValue | null => {
    if (!actions || !state) return null;
    // When sheet is closed image is centered in safe area; when sheet open the reaction drives layout.
    const expandedWidth = actions.screenWidth;
    const expandedHeight = actions.expandedHeightFromContext;
    return {
      ...actions,
      ...state,
      expandedWidth,
      expandedHeight,
    };
  }, [state, actions]);
}

export const IMAGE_OVERLAY_TIMING_CONFIG = TIMING_CONFIG;
