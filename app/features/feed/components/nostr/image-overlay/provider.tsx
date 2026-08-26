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
import { useScrollViewOffset } from '@/features/feed/hooks/useScrollViewOffset';
import type { EngagementViewState } from '@/features/feed/hooks/useNostrEngagement';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
import type { NoteMetrics } from '../feedTypes';
import {
  BOTTOM_PANEL_STIFF_DURATION_MS,
  CLEAR_URL_DELAY_MS,
  CLOSE_BLUR_AND_BTN_DURATION_MS,
  CLOSE_REMEASURE_TIMEOUT_MS,
  CLOSE_SPRING,
  OPEN_START_DELAY_MS,
  THUMB_BLUR_DISTANCE_FACTOR,
  THUMB_BLUR_MAX_INTENSITY,
} from './config';
import type {
  ImageOverlayPost,
  ImageOverlayLayout,
  ImageOverlayReplaceLayout,
  MediaType,
  OverlayMediaLayout,
  ThumbnailLayout,
  ImageOverlayContextValue,
} from './types';

const TIMING_CONFIG = {
  duration: CLOSE_BLUR_AND_BTN_DURATION_MS,
  easing: Easing.out(Easing.cubic),
};

/** State that changes on open/close; separate context to keep actions context stable. */
type ImageOverlayStateValue = Pick<
  ImageOverlayContextValue,
  | 'activeUrl'
  | 'activeAspectRatio'
  | 'activeUrls'
  | 'activeMediaTypes'
  | 'activeIndex'
  | 'activeOverlayPost'
  | 'videoFeedLayouts'
  | 'videoFeedLayoutIndex'
>;

/** Callbacks + shared values; stable across open/close so consumers don't re-render unnecessarily. */
type ImageOverlayActionsValue = Omit<
  ImageOverlayContextValue,
  | 'activeUrl'
  | 'activeAspectRatio'
  | 'activeUrls'
  | 'activeIndex'
  | 'activeOverlayPost'
  | 'activeMediaTypes'
  | 'videoFeedLayouts'
  | 'videoFeedLayoutIndex'
> & {
  onSwipeUpToNextPost: ((openNext: (layout: ImageOverlayReplaceLayout) => void) => void) | null;
};

const ImageOverlayStateContext = createContext<ImageOverlayStateValue | null>(null);
const ImageOverlayActionsContext = createContext<ImageOverlayActionsValue | null>(null);

/** Largest size that fits the screen without overflowing (preserves aspect ratio). Exported for hook. */
export function computeExpandedSize(
  screenWidth: number,
  screenHeight: number,
  aspectRatio: number
): { width: number; height: number } {
  // aspectRatio originates in relay-supplied event content; a hostile or
  // malformed `imeta`/`dim` tag can deliver 0, negative, NaN, or Infinity.
  // Without this guard the result poisons every downstream shared value
  // (centerX/Y, expandedWidth/Height) with NaN/Infinity and the overlay
  // silently renders nothing. Fall back to a square in the screen rect.
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    const side = Math.min(screenWidth, screenHeight);
    return { width: side, height: side };
  }
  const fitByWidth = screenWidth / aspectRatio <= screenHeight;
  if (fitByWidth) {
    return { width: screenWidth, height: screenWidth / aspectRatio };
  }
  return { width: screenHeight * aspectRatio, height: screenHeight };
}

/** Aspect ratio for a single replaced image that declares none (no measured thumbnail rect exists). */
const REPLACE_FALLBACK_ASPECT_RATIO = 16 / 9;

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|avi)(\?\S*)?$/i;

export function inferMediaType(url: string): 'image' | 'video' {
  return VIDEO_EXT.test(url) ? 'video' : 'image';
}

/** What the overlay shows for one open, and the rect it expands into. */
interface OverlayMedia {
  urls: string[];
  mediaTypes: MediaType[];
  initialIndex: number;
  aspectRatio: number;
  expandedWidth: number;
  expandedHeight: number;
}

/**
 * Resolve the pager contents and expanded rect for one overlay open.
 *
 * Videos render at natural aspect via contentFit=contain inside the pager
 * container, so the container itself must fill the full viewport — otherwise a
 * portrait video letterboxed inside a 16:9 rect ends up narrow. A multi-item
 * pager (any video, or more than one image) therefore fills the viewport so
 * every page shows at its own natural size, always as large as it fits. Sizing
 * the container to the tapped image's aspect instead would letterbox every
 * other (differently-shaped) image into that one box, which read as the
 * container "randomly" changing size between pages. A single image keeps its
 * own aspect so the shared-element transition lands precisely on the feed
 * thumbnail.
 *
 * `fallbackAspectRatio` is used only when the layout carries no `aspectRatio`
 * and the pager holds a single image: callers with a measured thumbnail rect
 * pass its ratio, callers without one pass a default.
 */
export function resolveOverlayMedia(
  layout: OverlayMediaLayout,
  screenWidth: number,
  availableHeight: number,
  fallbackAspectRatio: number
): OverlayMedia {
  const urls = layout.urls && layout.urls.length > 1 ? layout.urls : [layout.url];
  const mediaTypes =
    layout.mediaTypes && layout.mediaTypes.length === urls.length
      ? layout.mediaTypes
      : urls.map((u) => inferMediaType(u));
  const fillViewport = mediaTypes.some((t) => t === 'video') || urls.length > 1;
  const aspectRatio = fillViewport
    ? screenWidth / availableHeight
    : (layout.aspectRatio ?? fallbackAspectRatio);
  const { width, height } = computeExpandedSize(screenWidth, availableHeight, aspectRatio);
  return {
    urls,
    mediaTypes,
    initialIndex: Math.min(layout.initialIndex ?? 0, Math.max(0, urls.length - 1)),
    aspectRatio,
    expandedWidth: width,
    expandedHeight: height,
  };
}

/**
 * Resolve a just-in-time thumbnail re-measure with a timeout so close() never
 * hangs on a dead view (measureInWindow may never call back after unmount).
 * Resolves null on timeout or error; callers fall back to the open-time snapshot.
 */
function measureWithTimeout(
  measureNow: () => Promise<ThumbnailLayout | null>,
  timeoutMs: number
): Promise<ThumbnailLayout | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);
    measureNow()
      .then((layout) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(layout);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      });
  });
}

type ImageOverlayProviderProps = {
  children: React.ReactNode;
  /** When provided, overlay panel shows live metrics (optimistic counts) for the active post. */
  getDisplayMetrics?: (eventId: string) => NoteMetrics;
  /** When provided, overlay panel shows live engagement (liked, reposted, pending) for the active post. */
  getEngagementState?: (eventId: string) => EngagementViewState;
  /** When on a video page, swipe up calls this with openNext. Feed calls openNext(nextLayout) to show next video in overlay. */
  onSwipeUpToNextPost?: (openNext: (layout: ImageOverlayReplaceLayout) => void) => void;
  /** When provided, overlay can request layouts for TikTok-style vertical feed. Return layouts from current post onward; initialIndex is 0. */
  getVideoFeedLayoutsAndIndex?: () => {
    layouts: ImageOverlayReplaceLayout[];
    initialIndex: number;
  } | null;
};

export function ImageOverlayProvider({
  children,
  getDisplayMetrics,
  getEngagementState,
  onSwipeUpToNextPost,
  getVideoFeedLayoutsAndIndex,
}: ImageOverlayProviderProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { scrollOffsetY, scrollHandler } = useScrollViewOffset();
  const safeTop = insets.top;
  const safeBottom = insets.bottom;
  /** Image viewport: below notch only (no bottom inset) so image extends to screen bottom. */
  const imageViewportHeight = screenHeight - safeTop;

  const [activeUrls, setActiveUrls] = useState<string[]>([]);
  const [activeMediaTypes, setActiveMediaTypes] = useState<('image' | 'video')[]>([]);
  const [activeIndex, setActiveIndexState] = useState(0);
  const activeUrl = activeUrls.length > 0 ? (activeUrls[activeIndex] ?? activeUrls[0]) : null;
  const [activeAspectRatio, setActiveAspectRatio] = useState(16 / 9);
  const [activeOverlayPost, setActiveOverlayPost] = useState<ImageOverlayPost | null>(null);
  const [videoFeedLayouts, setVideoFeedLayoutsState] = useState<ImageOverlayReplaceLayout[] | null>(
    null
  );
  const [videoFeedLayoutIndex, setVideoFeedLayoutIndexState] = useState(0);

  const onSwipeUpToNextPostRef = useLatestRef<
    ((openNext: (layout: ImageOverlayReplaceLayout) => void) => void) | undefined
  >(onSwipeUpToNextPost);

  const setActiveIndex = useCallback((index: number) => {
    setActiveIndexState((prev) => (index === prev ? prev : index));
  }, []);

  const thumbnailLayoutsRef = useRef<Record<string, ThumbnailLayout>>({});
  /** See ImageOverlayContextValue.measureSpaceCorrection — tap-calibrated
   *  measure-space delta, stable ref so actionsValue identity is unaffected. */
  const measureSpaceCorrection = useRef({ dx: 0, dy: 0 });
  /** Per-key just-in-time measure callbacks: close() re-measures the live thumbnail because recycled FlashList rows never re-fire onLayout when size is unchanged, leaving the registered rect stale. */
  const thumbnailMeasureNowRef = useRef<Record<string, () => Promise<ThumbnailLayout | null>>>({});
  /** Bumped on every open/openReplace; a close() awaiting a re-measure aborts when the session changed under it (no double-close / close-after-reopen race). */
  const openSessionIdRef = useRef(0);
  /** Layout of the image we opened from (tap-time). Used for dismiss so we don't get overwritten by registerThumbnailLayout from other cards. */
  const openSessionInitialLayoutRef = useRef<ThumbnailLayout | null>(null);
  const openSessionInitialIndexRef = useRef(0);
  /** Snapshot of thumbnail layouts for every pager index at open() time. Prevents wrong height when dismissing from page 2/3 (ref would otherwise be overwritten by other cards). */
  const openSessionLayoutsByIndexRef = useRef<(ThumbnailLayout | null)[]>([]);
  /** Pending close-clear and open-panel-animation timers; cleared on unmount so we never fire setState after teardown. */
  const clearUrlTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openPanelAnimationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const registerThumbnailLayout = useCallback(
    (
      url: string,
      layout: ThumbnailLayout,
      options?: {
        eventId?: string;
        imageIndex?: number;
        measureNow?: () => Promise<ThumbnailLayout | null>;
      }
    ) => {
      const key =
        options?.eventId != null && options?.imageIndex != null
          ? `${options.eventId}-${options.imageIndex}`
          : url;
      thumbnailLayoutsRef.current[key] = layout;
      if (options?.measureNow) thumbnailMeasureNowRef.current[key] = options.measureNow;
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

  useEffect(() => {
    return () => {
      if (clearUrlTimeoutRef.current) clearTimeout(clearUrlTimeoutRef.current);
      if (openPanelAnimationTimeoutRef.current) clearTimeout(openPanelAnimationTimeoutRef.current);
    };
  }, []);

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
    setVideoFeedLayoutsState(null);
    setVideoFeedLayoutIndexState(0);
    hasPanelSv.value = 0;
    openAnimationInProgressSv.value = 0;
    panelHeightSv.value = 0;
    panelContentMinHeightSv.value = 0;
    openSessionInitialLayoutRef.current = null;
    openSessionLayoutsByIndexRef.current = [];
    // No overlay is open at clear-time, so cached thumbnail positions are
    // unreachable. Resetting bounds the ref's lifetime (audit 58 F-004).
    // Measure callbacks are reset for the same reason — they hold component
    // closures; live rows re-register via onLayout/tap before the next open.
    thumbnailLayoutsRef.current = {};
    thumbnailMeasureNowRef.current = {};
    if (clearUrlTimeoutRef.current) clearTimeout(clearUrlTimeoutRef.current);
    clearUrlTimeoutRef.current = setTimeout(() => {
      clearUrlTimeoutRef.current = null;
      setActiveUrls([]);
    }, CLEAR_URL_DELAY_MS);
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
    (minPanelHeight: number, aspectRatioOverride?: number) => {
      // openAnimationInProgressSv already set to 1 in open() when hasPanel so reaction skips from first frame
      const availableHeight = imageViewportHeight - minPanelHeight;
      const targetAspectRatio = aspectRatioOverride ?? aspectRatioSv.value;
      // Use thumbnail aspect ratio so overlay image rect matches the feed image; shared-element close animates correctly.
      const { width: expW, height: expH } = computeExpandedSize(
        screenWidth,
        availableHeight,
        targetAspectRatio
      );
      const centerY = safeTop + availableHeight / 2;
      centerYSv.value = centerY;
      expandedWidthSv.value = expW;
      expandedHeightSv.value = expH;
      aspectRatioSv.value = targetAspectRatio;
      scheduleOnUI(openPanelImageToFinal);
    },
    [
      screenWidth,
      safeTop,
      imageViewportHeight,
      aspectRatioSv,
      centerYSv,
      expandedWidthSv,
      expandedHeightSv,
      openPanelImageToFinal,
    ]
  );

  /**
   * Shared open/openReplace session bootstrap: bump the session, resolve the
   * media set, publish the JS-side state, and seed the layout/panel shared
   * values. When the layout carries a post we start with the sheet closed
   * (image centered in the viewport, absolute overlay on top); callers differ
   * only in the fallback aspect ratio and in what they animate afterwards.
   */
  const beginOverlaySession = useCallback(
    (layout: ImageOverlayReplaceLayout, fallbackAspectRatio: number) => {
      openSessionIdRef.current += 1;
      safeTopSv.value = safeTop;
      safeBottomSv.value = safeBottom;
      const hasPanel = !!layout.post;
      const availableHeight = imageViewportHeight;
      const media = resolveOverlayMedia(layout, screenWidth, availableHeight, fallbackAspectRatio);
      setActiveUrls(media.urls);
      setActiveMediaTypes(media.mediaTypes);
      setActiveIndexState(media.initialIndex);
      setActiveAspectRatio(media.aspectRatio);
      setActiveOverlayPost(layout.post ?? null);

      screenWidthSv.value = screenWidth;
      screenHeightSv.value = screenHeight;
      aspectRatioSv.value = media.aspectRatio;
      panelHeightSv.value = 0; // Sheet closed initially (or no panel at all)
      if (hasPanel) {
        hasPanelSv.value = 1;
        // Block panel reaction until the caller's open/replace animation runs.
        openAnimationInProgressSv.value = 1;
      } else {
        hasPanelSv.value = 0;
      }
      return { ...media, hasPanel, imageAreaCenterY: safeTop + availableHeight / 2 };
    },
    [
      safeTop,
      safeBottom,
      imageViewportHeight,
      screenWidth,
      screenHeight,
      safeTopSv,
      safeBottomSv,
      screenWidthSv,
      screenHeightSv,
      aspectRatioSv,
      panelHeightSv,
      hasPanelSv,
      openAnimationInProgressSv,
    ]
  );

  const open = useCallback(
    (layout: ImageOverlayLayout) => {
      const {
        urls,
        initialIndex,
        expandedWidth: expW,
        expandedHeight: expH,
        hasPanel,
        imageAreaCenterY,
        // Fall back to the measured thumbnail aspect so the overlay image rect
        // matches the feed image and the shared-element close lands on it.
      } = beginOverlaySession(layout, layout.width / layout.height);

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

        // 3. Start the expand animation in the same UI scheduling block.
        if (hasPanel) {
          openRevealUi();
          // Keep panel-open initial expand fully on UI thread.
          // Relying on a JS setTimeout here could intermittently miss and leave
          // the image at thumbnail size.
          openAnimationInProgressSv.value = 1;
          const targetX = centerXSv.value - expandedWidthSv.value / 2;
          const targetY = centerYSv.value - expandedHeightSv.value / 2;
          imageXCoord.value = withDelay(OPEN_START_DELAY_MS, withSpring(targetX, CLOSE_SPRING));
          imageYCoord.value = withDelay(OPEN_START_DELAY_MS, withSpring(targetY, CLOSE_SPRING));
          imageWidth.value = withDelay(
            OPEN_START_DELAY_MS,
            withSpring(expandedWidthSv.value, CLOSE_SPRING)
          );
          imageHeight.value = withDelay(
            OPEN_START_DELAY_MS,
            withSpring(expandedHeightSv.value, CLOSE_SPRING, () => {
              'worklet';
              openAnimationInProgressSv.value = 0;
            })
          );
        } else {
          openToCenter();
        }
      });
    },
    [
      beginOverlaySession,
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
      openAnimationInProgressSv,
      panelHeightSv,
    ]
  );

  /** Replace overlay content in-place (e.g. next video post). No open animation; image stays expanded. */
  const openReplace = useCallback(
    (layout: ImageOverlayReplaceLayout, options?: { preserveCloseTarget?: boolean }) => {
      const preserveCloseTarget = options?.preserveCloseTarget === true;
      const {
        urls,
        initialIndex,
        aspectRatio,
        expandedWidth: expW,
        expandedHeight: expH,
        hasPanel,
        imageAreaCenterY,
        // Replace layout carries no measured thumbnail rect, so a single image
        // with no declared aspect ratio falls back to 16:9.
      } = beginOverlaySession(layout, REPLACE_FALLBACK_ASPECT_RATIO);
      const centerX = screenWidth / 2;
      const toCenterY = hasPanel ? imageAreaCenterY : screenCenterY;

      const targetX = centerX - expW / 2;
      const targetY = toCenterY - expH / 2;
      if (!preserveCloseTarget) {
        closeTargetPageX.value = targetX;
        closeTargetPageY.value = targetY;
        closeTargetWidth.value = expW;
        closeTargetHeight.value = expH;
      }
      centerXSv.value = centerX;
      centerYSv.value = toCenterY;
      expandedWidthSv.value = expW;
      expandedHeightSv.value = expH;

      if (!preserveCloseTarget) {
        const eventId = layout.post?.event?.id;
        const keyForIndex = (i: number, u: string) => (eventId != null ? `${eventId}-${i}` : u);
        const centerLayout: ThumbnailLayout = {
          pageX: targetX,
          pageY: targetY,
          width: expW,
          height: expH,
        };
        openSessionInitialLayoutRef.current = centerLayout;
        openSessionInitialIndexRef.current = initialIndex;
        openSessionLayoutsByIndexRef.current = urls.map(() => centerLayout);
        urls.forEach((url, i) => {
          thumbnailLayoutsRef.current[keyForIndex(i, url)] = centerLayout;
        });
      }

      scheduleOnUI(() => {
        'worklet';
        cancelAnimation(imageXCoord);
        cancelAnimation(imageYCoord);
        cancelAnimation(imageWidth);
        cancelAnimation(imageHeight);
        closeSpringsDoneCount.value = 0;
        isClosing.value = false;
        imageState.value = 'open';
        imageXCoord.value = targetX;
        imageYCoord.value = targetY;
        imageWidth.value = expW;
        imageHeight.value = expH;
        blurIntensity.value = 100;
        closeBtnOpacity.value = 1;
        if (hasPanel) {
          openAnimationInProgressSv.value = 0;
        }
      });

      if (hasPanel) {
        if (openPanelAnimationTimeoutRef.current)
          clearTimeout(openPanelAnimationTimeoutRef.current);
        openPanelAnimationTimeoutRef.current = setTimeout(() => {
          openPanelAnimationTimeoutRef.current = null;
          startOpenPanelImageAnimation(0, aspectRatio);
        }, OPEN_START_DELAY_MS);
      }
    },
    [
      beginOverlaySession,
      screenWidth,
      screenCenterY,
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
      openAnimationInProgressSv,
      startOpenPanelImageAnimation,
    ]
  );

  const setVideoFeedLayouts = useCallback(
    (layouts: ImageOverlayReplaceLayout[] | null, initialIndex: number) => {
      setVideoFeedLayoutsState(layouts);
      setVideoFeedLayoutIndexState(initialIndex);
      if (layouts != null && layouts.length > 0) {
        const layout = layouts[initialIndex] ?? layouts[0];
        // Keep the original tapped-card close target when enabling vertical feed.
        openReplace(layout, { preserveCloseTarget: true });
      }
    },
    [openReplace]
  );

  const setVideoFeedIndex = useCallback(
    (index: number, layout: ImageOverlayReplaceLayout) => {
      setVideoFeedLayoutIndexState(index);
      openReplace(layout);
    },
    [openReplace]
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
    // Animate from current overlay rect to target; do not snap to target aspect first
    // (that caused a visible jump when dismissing after a pan).
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
    const onXFinish = () => {
      'worklet';
      imageXCoord.value = x;
      maybeFinishClose();
    };
    const onYFinish = () => {
      'worklet';
      imageYCoord.value = y;
      maybeFinishClose();
    };
    const onWFinish = () => {
      'worklet';
      imageWidth.value = w;
      maybeFinishClose();
    };
    const onHFinish = () => {
      'worklet';
      imageHeight.value = h;
      maybeFinishClose();
    };
    imageXCoord.value = withSpring(x, CLOSE_SPRING, onXFinish);
    imageYCoord.value = withSpring(y, CLOSE_SPRING, onYFinish);
    imageWidth.value = withSpring(w, CLOSE_SPRING, onWFinish);
    imageHeight.value = withSpring(h, CLOSE_SPRING, onHFinish);
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
   *
   * When the dismiss-target key has a registered measureNow, the live node is
   * re-measured just-in-time (recycled FlashList rows never re-fire onLayout
   * when size is unchanged, so the open-time snapshot can be stale). The close
   * animation then starts one tick later; the snapshot path stays the fallback
   * (timeout, unmounted node, or no callback).
   */
  const close = useCallback(
    (dismissedPageIndex?: number) => {
      const closeIndex =
        typeof dismissedPageIndex === 'number'
          ? dismissedPageIndex
          : Math.max(0, Math.min(activeIndex, Math.max(0, activeUrls.length - 1)));
      const eventId = activeOverlayPost?.event?.id;
      const urlAtIndex = activeUrls[closeIndex];
      const refKey =
        urlAtIndex != null
          ? eventId != null
            ? `${eventId}-${closeIndex}`
            : urlAtIndex
          : undefined;
      const sessionLayout = openSessionLayoutsByIndexRef.current[closeIndex] ?? null;
      const keyedLayout = refKey ? thumbnailLayoutsRef.current[refKey] : undefined;
      const initialLayout = openSessionInitialLayoutRef.current;
      const fallbackLayout =
        eventId != null
          ? (keyedLayout ?? sessionLayout ?? initialLayout ?? undefined)
          : (sessionLayout ?? keyedLayout ?? initialLayout ?? undefined);

      const applyTargetAndAnimate = (
        layout: ThumbnailLayout | undefined,
        isFreshWindowRect: boolean
      ) => {
        if (layout) {
          closeTargetPageX.value = layout.pageX;
          closeTargetPageY.value = layout.pageY;
          closeTargetWidth.value = layout.width;
          closeTargetHeight.value = layout.height;
          if (isFreshWindowRect) {
            // A just-measured rect is already in current window coordinates;
            // zero the worklet's scroll-at-open correction so it isn't applied
            // on top (targetY = pageY - scrollY + scrollAtOpen).
            scrollOffsetAtOpen.value = scrollOffsetY.value;
          }
        }
        scheduleOnUI(closeAnimationWorklet);
      };

      const measureNow = refKey != null ? thumbnailMeasureNowRef.current[refKey] : undefined;
      // Already closing (e.g. double-tap on close): keep the synchronous path;
      // the worklet's isClosing guard makes the second invocation a no-op.
      if (!measureNow || isClosing.value) {
        applyTargetAndAnimate(fallbackLayout, false);
        return;
      }
      const sessionId = openSessionIdRef.current;
      void measureWithTimeout(measureNow, CLOSE_REMEASURE_TIMEOUT_MS).then((fresh) => {
        // Overlay was reopened/replaced (or a parallel close won) while we
        // awaited — don't retarget or restart the animation.
        if (openSessionIdRef.current !== sessionId) return;
        if (isClosing.value) return;
        if (fresh && fresh.width > 0 && fresh.height > 0) {
          applyTargetAndAnimate(fresh, true);
        } else {
          applyTargetAndAnimate(fallbackLayout, false);
        }
      });
    },
    [
      activeIndex,
      activeUrls,
      activeOverlayPost?.event?.id,
      closeTargetPageX,
      closeTargetPageY,
      closeTargetWidth,
      closeTargetHeight,
      scrollOffsetAtOpen,
      scrollOffsetY,
      isClosing,
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
      activeMediaTypes,
      activeIndex,
      activeOverlayPost: effectiveOverlayPost,
      videoFeedLayouts,
      videoFeedLayoutIndex,
    }),
    [
      activeUrl,
      activeAspectRatio,
      activeUrls,
      activeMediaTypes,
      activeIndex,
      effectiveOverlayPost,
      videoFeedLayouts,
      videoFeedLayoutIndex,
    ]
  );

  const stableOnSwipeUp = useCallback((openNext: (layout: ImageOverlayReplaceLayout) => void) => {
    onSwipeUpToNextPostRef.current?.(openNext);
  }, []);

  const actionsValue = useMemo<ImageOverlayActionsValue>(() => {
    return {
      measureSpaceCorrection,
      scrollHandler,
      scrollOffsetY,
      scrollOffsetAtOpen,
      open,
      openReplace,
      close,
      openToCenter,
      registerThumbnailLayout,
      setPanelHeight,
      setPanelContentMinHeight,
      startOpenPanelImageAnimation,
      setActiveIndex,
      onSwipeUpToNextPost: onSwipeUpToNextPost ? stableOnSwipeUp : null,
      setVideoFeedLayouts,
      setVideoFeedIndex,
      getVideoFeedLayoutsAndIndex: getVideoFeedLayoutsAndIndex ?? null,
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
      thumbnailBlurIntensity,
      closeBtnOpacity,
      expandedWidthSv,
      expandedHeightSv,
      panelHeightSv,
      panelContentMinHeightSv,
    };
  }, [
    scrollHandler,
    scrollOffsetY,
    scrollOffsetAtOpen,
    open,
    openReplace,
    close,
    openToCenter,
    registerThumbnailLayout,
    setPanelHeight,
    setPanelContentMinHeight,
    startOpenPanelImageAnimation,
    setActiveIndex,
    onSwipeUpToNextPost,
    stableOnSwipeUp,
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
    thumbnailBlurIntensity,
    closeBtnOpacity,
    expandedWidthSv,
    expandedHeightSv,
    panelHeightSv,
    panelContentMinHeightSv,
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
    return { ...actions, ...state };
  }, [state, actions]);
}

export const IMAGE_OVERLAY_TIMING_CONFIG = TIMING_CONFIG;

/**
 * Feed scroll handler core: mirrors the list's scroll offset into the caller's
 * ref and the overlay's `scrollOffsetY` shared value. Lives at module scope in
 * the overlay's own module because (a) the React Compiler treats a shared-value
 * `.value =` write inside a component as modifying an immutable and skips the
 * whole component, and (b) HomeFeed and UserFeed both need the identical body.
 */
export function trackFeedScrollOffset(
  scrollOffsetRef: { current: number },
  imageOverlay: ImageOverlayContextValue | null,
  offsetY: number
): void {
  scrollOffsetRef.current = offsetY;
  if (imageOverlay?.scrollOffsetY != null) {
    imageOverlay.scrollOffsetY.value = offsetY;
  }
}
