/**
 * Provider for expandable image overlay (threads-style).
 * Tracks scroll offset and exposes open/close + shared values for the overlay.
 *
 * Performance logging (__DEV__ only, filter by [ImageOverlay:Perf]):
 * - open/close lifecycle and timings (open started, close started, finishClose, durations)
 * - context value identity (how often useMemo recreates → consumer re-renders)
 * - imageState changes (worklet → RN) for animation state tracking
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
import {
  CLEAR_URL_DELAY_MS,
  CLOSE_BLUR_AND_BTN_DURATION_MS,
  CLOSE_SPRING,
  OPEN_DURATION_MS,
  THUMB_BLUR_DISTANCE_FACTOR,
  THUMB_BLUR_MAX_INTENSITY,
} from './image-overlay.config';

const TIMING_CONFIG = {
  duration: OPEN_DURATION_MS,
  easing: Easing.out(Easing.quad),
};
function logCloseTarget(
  x: number,
  y: number,
  w: number,
  h: number,
  scrollY: number,
  scrollAtOpen: number
) {
  if (__DEV__) {
    console.log('[ImageOverlay] close() animating TO', {
      x,
      y,
      width: w,
      height: h,
      scrollOffsetY: scrollY,
      scrollOffsetAtOpen: scrollAtOpen,
      effectiveY: y,
    });
  }
}

/** Pager dismiss debug: log FROM (current overlay rect) and TO (target thumbnail rect). */
function logPagerDismissClose(
  fromX: number,
  fromY: number,
  fromW: number,
  fromH: number,
  toX: number,
  toY: number,
  toW: number,
  toH: number,
  activeIndex: number,
  activeUrlCount: number
) {
  if (__DEV__) {
    console.log('[ImageOverlay:PagerDismiss] close() started', {
      FROM_overlayRect: { x: fromX, y: fromY, width: fromW, height: fromH },
      TO_targetThumbnailRect: { x: toX, y: toY, width: toW, height: toH },
      activeIndex,
      activeUrlCount,
      sizeMismatch: fromW !== toW || fromH !== toH ? { fromW, fromH, toW, toH } : null,
    });
  }
}

function logSpringEnd(finalX: number, finalY: number, finalW: number, finalH: number) {
  if (__DEV__) {
    console.log('[ImageOverlay] spring ended at (final position/size)', {
      x: finalX,
      y: finalY,
      width: finalW,
      height: finalH,
    });
    console.log('[ImageOverlay:PagerDismiss] close animation ended at rect', {
      x: finalX,
      y: finalY,
      width: finalW,
      height: finalH,
    });
  }
}

/** Perf: log imageState change (called from worklet via scheduleOnRN). */
function logPerfImageState(state: 'open' | 'close') {
  if (__DEV__) {
    console.log('[ImageOverlay:Perf] imageState →', state);
  }
}

export interface ImageOverlayLayout {
  url: string;
  aspectRatio?: number;
  pageX: number;
  pageY: number;
  width: number;
  height: number;
  /** When opening a post with multiple images, pass all urls and the index of the tapped image. */
  urls?: string[];
  initialIndex?: number;
}

export type ThumbnailLayout = { pageX: number; pageY: number; width: number; height: number };

export type ImageOverlayContextValue = {
  scrollHandler: ReturnType<typeof useScrollViewOffset>['scrollHandler'];
  scrollOffsetY: ReturnType<typeof useScrollViewOffset>['scrollOffsetY'];
  open: (layout: ImageOverlayLayout) => void;
  close: () => void;
  openToCenter: () => void;
  /** Register a thumbnail's layout (e.g. from onLayout + measureInWindow). Used so pager dismiss animates to the correct image. */
  registerThumbnailLayout: (url: string, layout: ThumbnailLayout) => void;
  activeUrl: string | null;
  /** All image urls when overlay shows multiple (e.g. post with 2+ images). Same as [activeUrl] when single. */
  activeUrls: string[];
  /** Current page index when activeUrls.length > 1. */
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  activeAspectRatio: number;
  imageState: ReturnType<typeof useSharedValue<'open' | 'close'>>;
  imageXCoord: ReturnType<typeof useSharedValue<number>>;
  imageYCoord: ReturnType<typeof useSharedValue<number>>;
  imageWidth: ReturnType<typeof useSharedValue<number>>;
  imageHeight: ReturnType<typeof useSharedValue<number>>;
  blurIntensity: ReturnType<typeof useSharedValue<number>>;
  thumbnailBlurIntensity: ReturnType<typeof useDerivedValue<number>>;
  closeBtnOpacity: ReturnType<typeof useSharedValue<number>>;
  expandedWidth: number;
  expandedHeight: number;
  screenWidth: number;
  screenHeight: number;
};

/** State that changes on open/close; separate context to keep actions context stable. */
type ImageOverlayStateValue = Pick<
  ImageOverlayContextValue,
  'activeUrl' | 'activeAspectRatio' | 'activeUrls' | 'activeIndex'
>;

/** Callbacks + shared values; stable across open/close so consumers don't re-render unnecessarily. */
type ImageOverlayActionsValue = Omit<
  ImageOverlayContextValue,
  | 'activeUrl'
  | 'activeAspectRatio'
  | 'activeUrls'
  | 'activeIndex'
  | 'expandedWidth'
  | 'expandedHeight'
> & { screenWidth: number; screenHeight: number };

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

export function ImageOverlayProvider({ children }: { children: React.ReactNode }) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { scrollOffsetY, scrollHandler } = useScrollViewOffset();

  const [activeUrls, setActiveUrls] = useState<string[]>([]);
  const [activeIndex, setActiveIndexState] = useState(0);
  const activeUrl = activeUrls.length > 0 ? (activeUrls[activeIndex] ?? activeUrls[0]) : null;
  const [activeAspectRatio, setActiveAspectRatio] = useState(16 / 9);

  const setActiveIndex = useCallback((index: number) => {
    setActiveIndexState((prev) => (index === prev ? prev : index));
  }, []);

  const registerThumbnailLayout = useCallback((url: string, layout: ThumbnailLayout) => {
    if (__DEV__) {
      console.log('[ImageOverlay:PagerDismiss] registerThumbnailLayout', {
        urlShort: url.slice(0, 50) + (url.length > 50 ? '…' : ''),
        layout: {
          pageX: layout.pageX,
          pageY: layout.pageY,
          width: layout.width,
          height: layout.height,
        },
      });
    }
    thumbnailLayoutsRef.current[url] = layout;
  }, []);

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
  const activeIndexForLogSv = useSharedValue(0);
  const activeUrlCountForLogSv = useSharedValue(0);

  const centerXSv = useSharedValue(0);
  const centerYSv = useSharedValue(0);
  const expandedWidthSv = useSharedValue(0);
  const expandedHeightSv = useSharedValue(0);
  const closeSpringsDoneCount = useSharedValue(0);
  const isClosing = useSharedValue(false);

  const openTimestampRef = useRef(0);
  const closeTimestampRef = useRef(0);
  const thumbnailLayoutsRef = useRef<Record<string, ThumbnailLayout>>({});

  const logPerfCloseStartedCallback = useCallback(() => {
    if (__DEV__) {
      const openTs = openTimestampRef.current;
      closeTimestampRef.current = performance.now();
      console.log('[ImageOverlay:Perf] close() started', {
        openDurationMs: Math.round(closeTimestampRef.current - openTs),
      });
    }
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
    setTimeout(() => setActiveUrls([]), CLEAR_URL_DELAY_MS);
  }, []);

  const finishClose = useCallback(() => {
    if (__DEV__) {
      const now = performance.now();
      const closeAnimationMs = closeTimestampRef.current > 0 ? now - closeTimestampRef.current : 0;
      console.log('[ImageOverlay:Perf] finishClose()', {
        closeAnimationMs: Math.round(closeAnimationMs),
      });
    }
    imageState.value = 'close';
    isClosing.value = false;
    clearUrlDelayed();
  }, [clearUrlDelayed, imageState, isClosing]);

  const screenCenterX = screenWidth / 2;
  const screenCenterY = screenHeight / 2;

  const openToCenter = useCallback(() => {
    'worklet';
    const cx = centerXSv.value;
    const cy = centerYSv.value;
    const ew = expandedWidthSv.value;
    const eh = expandedHeightSv.value;
    blurIntensity.value = withTiming(100, TIMING_CONFIG);
    imageXCoord.value = withTiming(cx - ew / 2, TIMING_CONFIG);
    imageYCoord.value = withTiming(cy - eh / 2, TIMING_CONFIG);
    imageWidth.value = withTiming(ew, TIMING_CONFIG);
    imageHeight.value = withTiming(eh, TIMING_CONFIG);
    closeBtnOpacity.value = withDelay(OPEN_DURATION_MS, withTiming(1));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worklet captures shared-value refs
  }, []);

  const open = useCallback(
    (layout: ImageOverlayLayout) => {
      if (__DEV__) {
        openTimestampRef.current = performance.now();
        console.log('[ImageOverlay:Perf] open() started', { url: layout.url });
      }
      const aspectRatio = layout.aspectRatio ?? layout.width / layout.height;
      const { width: expW, height: expH } = computeExpandedSize(
        screenWidth,
        screenHeight,
        aspectRatio
      );

      const urls = layout.urls && layout.urls.length > 1 ? layout.urls : [layout.url];
      const initialIndex = Math.min(layout.initialIndex ?? 0, Math.max(0, urls.length - 1));
      setActiveUrls(urls);
      setActiveIndexState(initialIndex);
      setActiveAspectRatio(aspectRatio);

      scrollOffsetAtOpen.value = scrollOffsetY.value;
      closeTargetPageX.value = layout.pageX;
      closeTargetPageY.value = layout.pageY;
      closeTargetWidth.value = layout.width;
      closeTargetHeight.value = layout.height;
      thumbnailLayoutsRef.current[layout.url] = {
        pageX: layout.pageX,
        pageY: layout.pageY,
        width: layout.width,
        height: layout.height,
      };

      closeSpringsDoneCount.value = 0;
      isClosing.value = false;
      imageState.value = 'open';
      imageXCoord.value = layout.pageX;
      imageYCoord.value = layout.pageY;
      imageWidth.value = layout.width;
      imageHeight.value = layout.height;

      centerXSv.value = screenCenterX;
      centerYSv.value = screenCenterY;
      expandedWidthSv.value = expW;
      expandedHeightSv.value = expH;

      if (__DEV__) {
        const centerX = screenCenterX - expW / 2;
        const centerY = screenCenterY - expH / 2;
        console.log('[ImageOverlay] open()', {
          fromThumbnail: {
            x: layout.pageX,
            y: layout.pageY,
            width: layout.width,
            height: layout.height,
          },
          expandedSize: { width: expW, height: expH },
          toCenter: { x: centerX, y: centerY },
          closeTargetStored: {
            pageX: layout.pageX,
            pageY: layout.pageY,
            width: layout.width,
            height: layout.height,
          },
          scrollOffsetAtOpen: scrollOffsetY.value,
        });
        const urlCount = urls?.length ?? 1;
        console.log('[ImageOverlay:PagerDismiss] open() set closeTarget (shared-element source)', {
          urlShort: layout.url.slice(0, 50) + (layout.url.length > 50 ? '…' : ''),
          initialIndex,
          urlCount,
          closeTargetRect: {
            pageX: layout.pageX,
            pageY: layout.pageY,
            width: layout.width,
            height: layout.height,
          },
        });
      }

      // Cancel any in-flight animations from a previous close (e.g. pan-dismiss).
      // Otherwise Reanimated can leave shared values in a state where the next
      // JS-originated withTiming never runs, so tap-to-close sees current === target and skips animating.
      cancelAnimation(imageXCoord);
      cancelAnimation(imageYCoord);
      cancelAnimation(imageWidth);
      cancelAnimation(imageHeight);
      cancelAnimation(blurIntensity);
      cancelAnimation(closeBtnOpacity);

      // Run the expand-to-center animation on the UI thread so it's consistent with
      // close() (which runs on UI). Starting withTiming from JS after a UI-thread close
      // can fail to run, causing the next tap-to-close to have no visible animation.
      scheduleOnUI(openToCenter);
    },
    [
      screenWidth,
      screenHeight,
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
    ]
  );

  const close = useCallback(() => {
    'worklet';
    if (imageState.value !== 'open') return;
    if (isClosing.value) return;
    isClosing.value = true;

    scheduleOnRN(logPerfCloseStartedCallback);

    const fromX = imageXCoord.value;
    const fromY = imageYCoord.value;
    const fromW = imageWidth.value;
    const fromH = imageHeight.value;
    const x = closeTargetPageX.value;
    const scrollY = scrollOffsetY.value;
    const scrollAtOpen = scrollOffsetAtOpen.value;
    const y = closeTargetPageY.value - scrollY + scrollAtOpen;
    const w = closeTargetWidth.value;
    const h = closeTargetHeight.value;

    scheduleOnRN(
      logPagerDismissClose,
      fromX,
      fromY,
      fromW,
      fromH,
      x,
      y,
      w,
      h,
      activeIndexForLogSv.value,
      activeUrlCountForLogSv.value
    );
    scheduleOnRN(logCloseTarget, x, y, w, h, scrollY, scrollAtOpen);

    closeSpringsDoneCount.value = 0;

    const maybeFinishClose = () => {
      'worklet';
      closeSpringsDoneCount.value += 1;
      if (closeSpringsDoneCount.value === 4) {
        imageState.value = 'close';
        scheduleOnRN(logSpringEnd, x, y, w, h);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worklet captures shared-value refs
  }, [finishClose, imageState, logPerfCloseStartedCallback, isClosing]);

  useEffect(() => {
    activeIndexForLogSv.value = activeIndex;
    activeUrlCountForLogSv.value = activeUrls.length;
  }, [activeIndex, activeUrls.length, activeIndexForLogSv, activeUrlCountForLogSv]);

  useEffect(() => {
    if (activeUrls.length <= 1) return;
    const url = activeUrls[activeIndex];
    const layout = url ? thumbnailLayoutsRef.current[url] : undefined;
    if (__DEV__) {
      console.log('[ImageOverlay:PagerDismiss] closeTarget sync (activeIndex changed)', {
        activeIndex,
        activeUrlCount: activeUrls.length,
        activeUrlShort: url ? url.slice(0, 50) + (url.length > 50 ? '…' : '') : null,
        hasLayout: !!layout,
        layout: layout
          ? { pageX: layout.pageX, pageY: layout.pageY, width: layout.width, height: layout.height }
          : null,
      });
    }
    if (layout) {
      closeTargetPageX.value = layout.pageX;
      closeTargetPageY.value = layout.pageY;
      closeTargetWidth.value = layout.width;
      closeTargetHeight.value = layout.height;
    }
  }, [
    activeIndex,
    activeUrls,
    closeTargetPageX,
    closeTargetPageY,
    closeTargetWidth,
    closeTargetHeight,
  ]);

  const stateValue = useMemo<ImageOverlayStateValue>(
    () => ({ activeUrl, activeAspectRatio, activeUrls, activeIndex }),
    [activeUrl, activeAspectRatio, activeUrls, activeIndex]
  );

  const actionsRecreateCountRef = useRef(0);
  const actionsValue = useMemo<ImageOverlayActionsValue>(() => {
    actionsRecreateCountRef.current += 1;
    return {
      scrollHandler,
      scrollOffsetY,
      open,
      close,
      openToCenter,
      registerThumbnailLayout,
      setActiveIndex,
      imageState,
      imageXCoord,
      imageYCoord,
      imageWidth,
      imageHeight,
      blurIntensity,
      thumbnailBlurIntensity,
      closeBtnOpacity,
      screenWidth,
      screenHeight,
    };
  }, [
    scrollHandler,
    scrollOffsetY,
    open,
    close,
    openToCenter,
    registerThumbnailLayout,
    setActiveIndex,
    imageState,
    imageXCoord,
    imageYCoord,
    imageWidth,
    imageHeight,
    blurIntensity,
    thumbnailBlurIntensity,
    closeBtnOpacity,
    screenWidth,
    screenHeight,
  ]);

  useAnimatedReaction(
    () => imageState.value,
    (state) => {
      scheduleOnRN(logPerfImageState, state);
    }
  );

  useEffect(() => {
    if (__DEV__) {
      console.log(
        '[ImageOverlay:Perf] actions context recreated #',
        actionsRecreateCountRef.current
      );
    }
  }, [actionsValue]);

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
    const expanded = computeExpandedSize(
      actions.screenWidth,
      actions.screenHeight,
      state.activeAspectRatio
    );
    return {
      ...actions,
      ...state,
      expandedWidth: expanded.width,
      expandedHeight: expanded.height,
    };
  }, [state, actions]);
}

export const IMAGE_OVERLAY_TIMING_CONFIG = TIMING_CONFIG;
