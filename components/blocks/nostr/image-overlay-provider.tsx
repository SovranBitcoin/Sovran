/**
 * Provider for expandable image overlay (threads-style).
 * Tracks scroll offset and exposes open/close + shared values for the overlay.
 *
 * Performance logging (__DEV__ only, filter by [Image:Perf]):
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
  BOTTOM_PANEL_MAX_HEIGHT_FRACTION,
  BOTTOM_PANEL_STIFF_DURATION_MS,
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

/** Verbose log for agent analysis: tag + arbitrary payload. All [Image:Verbose] logs. */
function logImageVerbose(tag: string, payload: Record<string, unknown>) {
  if (__DEV__) {
    console.log(`[Image:Verbose] ${tag}`, payload);
  }
}

/** Format rect + aspect ratio for [Image:Rect] debug logs. */
function rectWithAspect(
  label: string,
  x: number,
  y: number,
  w: number,
  h: number
): { label: string; x: number; y: number; width: number; height: number; aspectRatio: number } {
  const aspectRatio = h > 0 ? w / h : 0;
  return {
    label,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(w),
    height: Math.round(h),
    aspectRatio: Math.round(aspectRatio * 1000) / 1000,
  };
}

function logCloseTarget(
  x: number,
  y: number,
  w: number,
  h: number,
  scrollY: number,
  scrollAtOpen: number
) {
  if (__DEV__) {
    const r = rectWithAspect('sharedElement_target', x, y, w, h);
    console.log('[Image:Rect] close() animating TO (shared element target)', {
      ...r,
      scrollOffsetY: scrollY,
      scrollOffsetAtOpen: scrollAtOpen,
      effectiveY: y,
    });
    console.log('[Image:Overlay] close() animating TO', {
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

/** Dismiss: overlay animated rect vs image block (close target) — dimensions and deltas. */
function logImageDismissComparison(
  overlayX: number,
  overlayY: number,
  overlayW: number,
  overlayH: number,
  blockX: number,
  blockY: number,
  blockW: number,
  blockH: number,
  label: string
) {
  if (__DEV__) {
    const deltaX = overlayX - blockX;
    const deltaY = overlayY - blockY;
    const deltaW = overlayW - blockW;
    const deltaH = overlayH - blockH;
    console.log(`[Image:dismiss] ${label} — overlay vs image block`, {
      overlay: {
        x: Math.round(overlayX),
        y: Math.round(overlayY),
        w: Math.round(overlayW),
        h: Math.round(overlayH),
      },
      block: {
        x: Math.round(blockX),
        y: Math.round(blockY),
        w: Math.round(blockW),
        h: Math.round(blockH),
      },
      delta: {
        x: Math.round(deltaX),
        y: Math.round(deltaY),
        w: Math.round(deltaW),
        h: Math.round(deltaH),
      },
      match: { x: deltaX === 0, y: deltaY === 0, w: deltaW === 0, h: deltaH === 0 },
    });
    console.log('[Image:dismiss] aspect ratios', {
      overlayAR: overlayH > 0 ? Math.round((overlayW / overlayH) * 1000) / 1000 : null,
      blockAR: blockH > 0 ? Math.round((blockW / blockH) * 1000) / 1000 : null,
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
    logImageDismissComparison(fromX, fromY, fromW, fromH, toX, toY, toW, toH, 'close() started');
    const from = rectWithAspect('overlay_current', fromX, fromY, fromW, fromH);
    const to = rectWithAspect('sharedElement_target', toX, toY, toW, toH);
    console.log('[Image:Rect] dismiss FROM overlay → TO shared element', {
      FROM_overlay: from,
      TO_sharedElement: to,
      activeIndex,
      activeUrlCount,
      widthMatch: fromW === toW,
      heightMatch: fromH === toH,
      aspectRatioMatch: from.aspectRatio === to.aspectRatio,
    });
    console.log('[Image:PagerDismiss] close() started', {
      FROM_overlayRect: { x: fromX, y: fromY, width: fromW, height: fromH },
      TO_targetThumbnailRect: { x: toX, y: toY, width: toW, height: toH },
      activeIndex,
      activeUrlCount,
      sizeMismatch: fromW !== toW || fromH !== toH ? { fromW, fromH, toW, toH } : null,
    });
  }
}

/** Verbose: close() worklet state (called via scheduleOnRN). */
function logImageVerboseClose(
  fromX: number,
  fromY: number,
  fromW: number,
  fromH: number,
  rawTargetX: number,
  rawTargetY: number,
  rawTargetW: number,
  rawTargetH: number,
  scrollY: number,
  scrollAtOpen: number,
  effectiveY: number,
  damping: number,
  stiffness: number,
  mass: number
) {
  if (__DEV__) {
    logImageVerbose('close() worklet', {
      overlayRect_current: { x: fromX, y: fromY, w: fromW, h: fromH },
      blockTarget_raw: { x: rawTargetX, y: rawTargetY, w: rawTargetW, h: rawTargetH },
      scroll: { scrollY, scrollAtOpen },
      effectiveYFormula: 'closeTargetPageY - scrollY + scrollAtOpen',
      effectiveY,
      springConfig: { damping, stiffness, mass },
      springsStarted: 4,
      springTargets: { x: rawTargetX, y: effectiveY, w: rawTargetW, h: rawTargetH },
    });
  }
}

function logSpringEnd(
  finalX: number,
  finalY: number,
  finalW: number,
  finalH: number,
  targetX: number,
  targetY: number,
  targetW: number,
  targetH: number
) {
  if (__DEV__) {
    logImageDismissComparison(
      finalX,
      finalY,
      finalW,
      finalH,
      targetX,
      targetY,
      targetW,
      targetH,
      'spring ended'
    );
    const r = rectWithAspect('final_after_spring', finalX, finalY, finalW, finalH);
    console.log('[Image:Rect] close animation ended (final rect)', r);
    console.log('[Image:Overlay] spring ended at (final position/size)', {
      x: finalX,
      y: finalY,
      width: finalW,
      height: finalH,
    });
    console.log('[Image:PagerDismiss] close animation ended at rect', {
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
    console.log('[Image:Perf] imageState →', state);
  }
}

/** Verbose: openPanel worklet state (called from worklet via scheduleOnRN). */
function logImageVerboseOpenPanelWorklet(
  startX: number,
  startY: number,
  startW: number,
  startH: number,
  targetX: number,
  targetY: number,
  targetW: number,
  targetH: number,
  centerX: number,
  centerY: number,
  durationMs: number
) {
  if (__DEV__) {
    logImageVerbose('openPanelImageToFinal worklet', {
      overlayRect_beforeAnimation: { x: startX, y: startY, w: startW, h: startH },
      targetRect: { x: targetX, y: targetY, w: targetW, h: targetH },
      centerSv: { centerX, centerY },
      timing: { durationMs, easing: 'Easing.out(Easing.quad)' },
      delta: {
        x: targetX - startX,
        y: targetY - startY,
        w: targetW - startW,
        h: targetH - startH,
      },
    });
  }
}

/** Debug: openWithPanelAnimate target (called from worklet via scheduleOnRN). */
function logImageOpenPanelTarget(imageX: number, imageY: number, imageW: number, imageH: number) {
  if (__DEV__) {
    const r = rectWithAspect('openPanel_target', imageX, imageY, imageW, imageH);
    console.log('[Image:Rect] openPanel animation target (overlay final rect)', r);
    console.log('[Image:openPanelAnimate target]', {
      imageRect: {
        x: Math.round(imageX),
        y: Math.round(imageY),
        w: Math.round(imageW),
        h: Math.round(imageH),
      },
      imageY,
    });
  }
}

/** Debug: open panel animation done, reaction will take over (called from worklet via scheduleOnRN). */
function logImageOpenPanelComplete() {
  if (__DEV__) {
    console.log('[Image:openPanelAnimate complete] reaction will drive image from now');
  }
}

/** Post payload for overlay bottom panel (author, content, stats, actions). Kept minimal to avoid circular deps. */
export interface ImageOverlayPost {
  event: {
    id: string;
    pubkey: string;
    content: string;
    created_at: number;
  };
  metrics: {
    replyCount: number;
    repostCount: number;
    likeCount: number;
    satsZapped: number;
  };
  profile?: { name: string; picture?: string } | null;
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
  /** When opening from a post card, pass post data so the overlay can show author, content, stats, reply. */
  post?: ImageOverlayPost | null;
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
  /** Set panel height (drives image area); used after content measure and when panel is dragged. */
  setPanelHeight: (height: number) => void;
  /** Report measured min content height so overlay can use it for snap points. */
  setPanelContentMinHeight: (height: number) => void;
  /** Start image open animation to final position (for min panel). Call from overlay onLayout when has panel. */
  startOpenPanelImageAnimation: (minPanelHeight: number) => void;
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
  /** Shared values for layout that updates with panel drag (use in animated styles when activeOverlayPost). */
  expandedWidthSv: ReturnType<typeof useSharedValue<number>>;
  expandedHeightSv: ReturnType<typeof useSharedValue<number>>;
  panelHeightSv: ReturnType<typeof useSharedValue<number>>;
  panelContentMinHeightSv: ReturnType<typeof useSharedValue<number>>;
  screenWidth: number;
  screenHeight: number;
  /** Post data for overlay bottom panel; set when open(layout) is called with layout.post. */
  activeOverlayPost: ImageOverlayPost | null;
};

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
  const [activeOverlayPost, setActiveOverlayPost] = useState<ImageOverlayPost | null>(null);

  const setActiveIndex = useCallback((index: number) => {
    setActiveIndexState((prev) => (index === prev ? prev : index));
  }, []);

  const registerThumbnailLayout = useCallback((url: string, layout: ThumbnailLayout) => {
    if (__DEV__) {
      const prev = thumbnailLayoutsRef.current[url];
      const r = rectWithAspect(
        'thumbnail_registered',
        layout.pageX,
        layout.pageY,
        layout.width,
        layout.height
      );
      console.log('[Image:Rect] registerThumbnailLayout (original image / shared-element source)', {
        ...r,
        urlShort: url.slice(0, 50) + (url.length > 50 ? '…' : ''),
      });
      console.log('[Image:PagerDismiss] registerThumbnailLayout', {
        urlShort: url.slice(0, 50) + (url.length > 50 ? '…' : ''),
        layout: {
          pageX: layout.pageX,
          pageY: layout.pageY,
          width: layout.width,
          height: layout.height,
        },
      });
      logImageVerbose('registerThumbnailLayout', {
        urlShort: url.slice(0, 40),
        layout: {
          pageX: layout.pageX,
          pageY: layout.pageY,
          width: layout.width,
          height: layout.height,
        },
        aspectRatio: layout.height > 0 ? layout.width / layout.height : null,
        previousLayoutForUrl: prev
          ? { pageX: prev.pageX, pageY: prev.pageY, width: prev.width, height: prev.height }
          : null,
        overwrites: !!prev,
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

  const panelHeightSv = useSharedValue(0);
  const panelContentMinHeightSv = useSharedValue(0);
  const aspectRatioSv = useSharedValue(16 / 9);
  const hasPanelSv = useSharedValue(0);
  /** 1 while image is animating from thumbnail to expanded on open-with-panel; reaction skips so it doesn't overwrite. */
  const openAnimationInProgressSv = useSharedValue(0);
  const screenWidthSv = useSharedValue(0);
  const screenHeightSv = useSharedValue(0);

  const setPanelHeight = useCallback(
    (height: number) => {
      if (__DEV__) {
        console.log('[Image:setPanelHeight]', {
          height: Math.round(height),
          duration: BOTTOM_PANEL_STIFF_DURATION_MS,
        });
        logImageVerbose('setPanelHeight', {
          height,
          durationMs: BOTTOM_PANEL_STIFF_DURATION_MS,
          easing: 'Easing.out(Easing.cubic)',
          drives: 'panelHeightSv → panel reaction updates expandedHeightSv, centerYSv, image rect',
        });
      }
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

  const openTimestampRef = useRef(0);
  const closeTimestampRef = useRef(0);
  const thumbnailLayoutsRef = useRef<Record<string, ThumbnailLayout>>({});
  /** Layout of the image we opened from (tap-time). Used for dismiss so we don't get overwritten by registerThumbnailLayout from other cards. */
  const openSessionInitialLayoutRef = useRef<ThumbnailLayout | null>(null);
  const openSessionInitialIndexRef = useRef(0);
  /** Snapshot of thumbnail layouts for every pager index at open() time. Prevents wrong height when dismissing from page 2/3 (ref would otherwise be overwritten by other cards). */
  const openSessionLayoutsByIndexRef = useRef<(ThumbnailLayout | null)[]>([]);

  const logPerfCloseStartedCallback = useCallback(() => {
    if (__DEV__) {
      const openTs = openTimestampRef.current;
      closeTimestampRef.current = performance.now();
      console.log('[Image:Perf] close() started', {
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
    if (__DEV__) {
      const now = performance.now();
      const closeAnimationMs = closeTimestampRef.current > 0 ? now - closeTimestampRef.current : 0;
      console.log('[Image:Perf] finishClose()', {
        closeAnimationMs: Math.round(closeAnimationMs),
      });
      logImageVerbose('finishClose', {
        closeAnimationMs: Math.round(closeAnimationMs),
        next: [
          'imageState=close',
          'isClosing=false',
          'clearUrlDelayed()',
          `setActiveUrls([]) after ${CLEAR_URL_DELAY_MS}ms`,
        ],
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

  /** Only blur + close button (and thus dots/panel). Used when opening with panel so image stays at thumbnail until startOpenPanelImageAnimation. */
  const openRevealUi = useCallback(() => {
    'worklet';
    blurIntensity.value = withTiming(100, TIMING_CONFIG);
    closeBtnOpacity.value = withDelay(OPEN_DURATION_MS, withTiming(1));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worklet captures shared-value refs
  }, []);

  /** Worklet: animate image from thumbnail to current centerYSv/expandedWidthSv/expandedHeightSv (final position). */
  const openPanelImageToFinal = useCallback(() => {
    'worklet';
    openAnimationInProgressSv.value = 1;
    const startX = imageXCoord.value;
    const startY = imageYCoord.value;
    const startW = imageWidth.value;
    const startH = imageHeight.value;
    const cx = centerXSv.value;
    const cy = centerYSv.value;
    const ew = expandedWidthSv.value;
    const eh = expandedHeightSv.value;
    const targetX = cx - ew / 2;
    const targetY = cy - eh / 2;
    if (__DEV__) {
      scheduleOnRN(
        logImageVerboseOpenPanelWorklet,
        startX,
        startY,
        startW,
        startH,
        targetX,
        targetY,
        ew,
        eh,
        cx,
        cy,
        OPEN_DURATION_MS
      );
      scheduleOnRN(logImageOpenPanelTarget, targetX, targetY, ew, eh);
    }
    imageXCoord.value = withTiming(targetX, TIMING_CONFIG);
    imageYCoord.value = withTiming(targetY, TIMING_CONFIG);
    imageWidth.value = withTiming(ew, TIMING_CONFIG);
    imageHeight.value = withTiming(eh, TIMING_CONFIG, () => {
      openAnimationInProgressSv.value = 0;
      if (__DEV__) scheduleOnRN(logImageOpenPanelComplete);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worklet captures shared-value refs
  }, []);

  const startOpenPanelImageAnimation = useCallback(
    (minPanelHeight: number) => {
      // openAnimationInProgressSv already set to 1 in open() when hasPanel so reaction skips from first frame
      const availableHeight = screenHeight - minPanelHeight;
      // Max viewport so each image fits independently (contentFit="contain")
      const expW = screenWidth;
      const expH = availableHeight;
      const centerY = availableHeight / 2;
      const targetX = screenCenterX - expW / 2;
      const targetY = centerY - expH / 2;
      if (__DEV__) {
        const viewport = rectWithAspect('viewport_above_panel', 0, 0, expW, expH);
        const target = rectWithAspect('overlay_image_target', targetX, targetY, expW, expH);
        console.log('[Image:Rect] startOpenPanelImageAnimation — viewport and overlay target', {
          minPanelHeight: Math.round(minPanelHeight),
          availableHeight: Math.round(availableHeight),
          viewport,
          overlay_target: target,
          centerY: Math.round(centerY),
          activeAspectRatio,
        });
        logImageVerbose('startOpenPanelImageAnimation formulas', {
          minPanelHeight,
          formula_availableHeight: 'screenHeight - minPanelHeight',
          screenHeight,
          availableHeight,
          formula_centerY: 'availableHeight / 2',
          centerY,
          expW: screenWidth,
          expH: availableHeight,
          formula_targetX: 'screenCenterX - expW / 2',
          targetX,
          formula_targetY: 'centerY - expH / 2',
          targetY,
          activeAspectRatio,
          nextStep: 'scheduleOnUI(openPanelImageToFinal)',
        });
      }
      centerYSv.value = centerY;
      expandedWidthSv.value = expW;
      expandedHeightSv.value = expH;
      aspectRatioSv.value = activeAspectRatio;
      scheduleOnUI(openPanelImageToFinal);
    },
    [
      screenWidth,
      screenHeight,
      screenCenterX,
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
      if (__DEV__) {
        openTimestampRef.current = performance.now();
        console.log('[Image:Perf] open() started', { url: layout.url });
      }
      const aspectRatio = layout.aspectRatio ?? layout.width / layout.height;
      const hasPanel = !!layout.post;
      const availableHeight = hasPanel
        ? screenHeight * (1 - BOTTOM_PANEL_MAX_HEIGHT_FRACTION)
        : screenHeight;
      // Max viewport so each image fits independently (contentFit="contain"); not tied to clicked image aspect ratio
      const expW = screenWidth;
      const expH = availableHeight;
      const imageAreaCenterY = availableHeight / 2;

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
        panelHeightSv.value = screenHeight * BOTTOM_PANEL_MAX_HEIGHT_FRACTION;
        // Block panel reaction until startOpenPanelImageAnimation runs (reaction runs on mount before onLayout)
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
      thumbnailLayoutsRef.current[layout.url] = {
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
      // Snapshot layout per pager index at open time so dismiss from any page uses stable dimensions (not overwritten by other cards).
      openSessionLayoutsByIndexRef.current = urls.map((url, i) =>
        i === initialIndex ? tapLayout : (thumbnailLayoutsRef.current[url] ?? null)
      );

      closeSpringsDoneCount.value = 0;
      isClosing.value = false;
      imageState.value = 'open';
      imageXCoord.value = layout.pageX;
      imageYCoord.value = layout.pageY;
      imageWidth.value = layout.width;
      imageHeight.value = layout.height;

      centerXSv.value = screenCenterX;
      centerYSv.value = hasPanel ? imageAreaCenterY : screenCenterY;
      expandedWidthSv.value = expW;
      expandedHeightSv.value = expH;

      if (__DEV__) {
        const centerX = screenCenterX - expW / 2;
        const centerYForImage = imageAreaCenterY - expH / 2;
        const original = rectWithAspect(
          'original_image_thumbnail',
          layout.pageX,
          layout.pageY,
          layout.width,
          layout.height
        );
        const overlayTarget = rectWithAspect(
          'overlay_expanded_target',
          centerX,
          centerYForImage,
          expW,
          expH
        );
        console.log(
          '[Image:Rect] open() — original image (shared-element source) vs overlay target',
          {
            original_image: original,
            overlay_target: overlayTarget,
            hasPanel,
            availableHeight: Math.round(availableHeight),
            imageAreaCenterY: Math.round(imageAreaCenterY),
          }
        );
        console.log('[Image:open]', {
          hasPanel,
          screenHeight,
          panelHeight: hasPanel ? screenHeight * BOTTOM_PANEL_MAX_HEIGHT_FRACTION : 0,
          availableHeight,
          imageAreaCenterY,
          initialImageRect: {
            x: layout.pageX,
            y: layout.pageY,
            w: layout.width,
            h: layout.height,
          },
          expandedSize: { w: expW, h: expH },
          targetImageRect: { x: centerX, y: centerYForImage, w: expW, h: expH },
          targetImageY: centerYForImage,
        });
        console.log('[Image:Overlay] open()', {
          fromThumbnail: {
            x: layout.pageX,
            y: layout.pageY,
            width: layout.width,
            height: layout.height,
          },
          expandedSize: { width: expW, height: expH },
          toCenter: { x: centerX, y: centerYForImage },
          closeTargetStored: {
            pageX: layout.pageX,
            pageY: layout.pageY,
            width: layout.width,
            height: layout.height,
          },
          scrollOffsetAtOpen: scrollOffsetY.value,
        });
        const urlCount = urls?.length ?? 1;
        const closeTargetRect = rectWithAspect(
          'open_stored_closeTarget',
          layout.pageX,
          layout.pageY,
          layout.width,
          layout.height
        );
        console.log(
          '[Image:Rect] open() stored closeTarget (dismiss will animate TO this)',
          closeTargetRect
        );
        console.log('[Image:PagerDismiss] open() set closeTarget (shared-element source)', {
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
        logImageVerbose('open() full state', {
          layout: {
            url: layout.url?.slice(0, 40),
            pageX: layout.pageX,
            pageY: layout.pageY,
            width: layout.width,
            height: layout.height,
            aspectRatio: layout.aspectRatio,
            urlsLength: layout.urls?.length,
            initialIndex: layout.initialIndex,
            hasPost: !!layout.post,
          },
          screen: { screenWidth, screenHeight },
          hasPanel,
          BOTTOM_PANEL_MAX_HEIGHT_FRACTION,
          availableHeightFormula: hasPanel
            ? `screenHeight * (1 - ${BOTTOM_PANEL_MAX_HEIGHT_FRACTION})`
            : 'screenHeight',
          availableHeight,
          expW,
          expH,
          imageAreaCenterY,
          screenCenterX,
          centerXForImage: screenCenterX - expW / 2,
          centerYForImage: imageAreaCenterY - expH / 2,
          urlsLength: urls.length,
          initialIndex,
          sharedValuesSet: {
            imageXCoord: layout.pageX,
            imageYCoord: layout.pageY,
            imageWidth: layout.width,
            imageHeight: layout.height,
            centerYSv: hasPanel ? imageAreaCenterY : screenCenterY,
            expandedWidthSv: expW,
            expandedHeightSv: expH,
            panelHeightSv: hasPanel ? screenHeight * BOTTOM_PANEL_MAX_HEIGHT_FRACTION : 0,
            openAnimationInProgressSv: hasPanel ? 1 : 0,
          },
          scrollOffsetY: scrollOffsetY.value,
          scrollOffsetAtOpen: scrollOffsetAtOpen.value,
          nextStep: hasPanel ? 'scheduleOnUI(openRevealUi)' : 'scheduleOnUI(openToCenter)',
        });
      }

      // Cancel any in-flight animations from a previous close (e.g. pan-dismiss).
      // Otherwise Reanimated can leave shared values in a state where the next
      // JS-originated withTiming never runs, so tap-to-close sees current === target and skips animating.
      if (__DEV__) {
        logImageVerbose('open() cancelAnimation', {
          cancelled: [
            'imageXCoord',
            'imageYCoord',
            'imageWidth',
            'imageHeight',
            'blurIntensity',
            'closeBtnOpacity',
            'panelHeightSv',
          ],
          reason: 'clear in-flight close/pan-dismiss so expand animation runs',
        });
      }
      cancelAnimation(imageXCoord);
      cancelAnimation(imageYCoord);
      cancelAnimation(imageWidth);
      cancelAnimation(imageHeight);
      cancelAnimation(blurIntensity);
      cancelAnimation(closeBtnOpacity);
      cancelAnimation(panelHeightSv);

      // Run the expand-to-center animation on the UI thread. When hasPanel, only reveal blur+btn; overlay will call startOpenPanelImageAnimation(minPanelHeight) so image animates to final position (no overshoot).
      if (hasPanel) scheduleOnUI(openRevealUi);
      else scheduleOnUI(openToCenter);
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
      openRevealUi,
      hasPanelSv,
      openAnimationInProgressSv,
      panelHeightSv,
      aspectRatioSv,
      screenWidthSv,
      screenHeightSv,
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
    if (__DEV__) {
      const rawTargetY = closeTargetPageY.value;
      scheduleOnRN(
        logImageVerboseClose,
        fromX,
        fromY,
        fromW,
        fromH,
        x,
        rawTargetY,
        w,
        h,
        scrollY,
        scrollAtOpen,
        y,
        24,
        320,
        0.8
      );
    }

    closeSpringsDoneCount.value = 0;

    const maybeFinishClose = () => {
      'worklet';
      closeSpringsDoneCount.value += 1;
      if (closeSpringsDoneCount.value === 4) {
        imageState.value = 'close';
        const fx = imageXCoord.value;
        const fy = imageYCoord.value;
        const fw = imageWidth.value;
        const fh = imageHeight.value;
        scheduleOnRN(logSpringEnd, fx, fy, fw, fh, x, y, w, h);
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
    let sessionLayoutByIndex = openSessionLayoutsByIndexRef.current[activeIndex] ?? null;
    const refLayout = url ? thumbnailLayoutsRef.current[url] : undefined;
    // If we had no snapshot for this index (e.g. other image hadn't registered at open()), use ref and backfill so we don't pick up a later overwrite from another card
    if (!sessionLayoutByIndex && refLayout) {
      openSessionLayoutsByIndexRef.current[activeIndex] = refLayout;
      sessionLayoutByIndex = refLayout;
    }
    const layout = sessionLayoutByIndex ?? refLayout;
    if (__DEV__) {
      logImageVerbose('pager closeTarget sync decision', {
        activeIndex,
        openSessionInitialIndex: openSessionInitialIndexRef.current,
        useSessionLayout: !!sessionLayoutByIndex,
        sessionLayout: sessionLayoutByIndex
          ? {
              pageX: sessionLayoutByIndex.pageX,
              pageY: sessionLayoutByIndex.pageY,
              width: sessionLayoutByIndex.width,
              height: sessionLayoutByIndex.height,
            }
          : null,
        refLayout: refLayout
          ? {
              pageX: refLayout.pageX,
              pageY: refLayout.pageY,
              width: refLayout.width,
              height: refLayout.height,
            }
          : null,
        chosen: layout
          ? sessionLayoutByIndex
            ? 'sessionLayoutByIndex'
            : 'thumbnailLayoutsRef'
          : 'none',
      });
      if (layout) {
        const r = rectWithAspect(
          'pager_closeTarget_synced',
          layout.pageX,
          layout.pageY,
          layout.width,
          layout.height
        );
        console.log(
          '[Image:Rect] pager closeTarget sync (activeIndex changed) — shared-element target for dismiss',
          {
            ...r,
            activeIndex,
            activeUrlCount: activeUrls.length,
            activeUrlShort: url ? url.slice(0, 50) + (url.length > 50 ? '…' : '') : null,
            source: sessionLayoutByIndex ? 'openSession_layouts_by_index' : 'thumbnailLayoutsRef',
          }
        );
      }
      console.log('[Image:PagerDismiss] closeTarget sync (activeIndex changed)', {
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
      if (__DEV__) {
        console.log('[Image:dismiss] image block dimensions set (close target for dismiss)', {
          activeIndex,
          block: {
            x: Math.round(layout.pageX),
            y: Math.round(layout.pageY),
            w: Math.round(layout.width),
            h: Math.round(layout.height),
          },
          aspectRatio:
            layout.height > 0 ? Math.round((layout.width / layout.height) * 1000) / 1000 : null,
          source: sessionLayoutByIndex ? 'openSession_layouts_by_index' : 'thumbnailLayoutsRef',
        });
      }
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
    () => ({ activeUrl, activeAspectRatio, activeUrls, activeIndex, activeOverlayPost }),
    [activeUrl, activeAspectRatio, activeUrls, activeIndex, activeOverlayPost]
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
      setPanelHeight,
      setPanelContentMinHeight,
      startOpenPanelImageAnimation,
      setActiveIndex,
      imageState,
      imageXCoord,
      imageYCoord,
      imageWidth,
      imageHeight,
      blurIntensity,
      thumbnailBlurIntensity,
      closeBtnOpacity,
      expandedWidthSv,
      expandedHeightSv,
      panelHeightSv,
      panelContentMinHeightSv,
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
    setPanelHeight,
    setPanelContentMinHeight,
    startOpenPanelImageAnimation,
    setActiveIndex,
    imageState,
    imageXCoord,
    imageYCoord,
    imageWidth,
    imageHeight,
    blurIntensity,
    thumbnailBlurIntensity,
    closeBtnOpacity,
    expandedWidthSv,
    expandedHeightSv,
    panelHeightSv,
    panelContentMinHeightSv,
    screenWidth,
    screenHeight,
  ]);

  useAnimatedReaction(
    () => imageState.value,
    (state) => {
      scheduleOnRN(logPerfImageState, state);
    }
  );

  useAnimatedReaction(
    () => panelHeightSv.value,
    (panelH) => {
      if (hasPanelSv.value !== 1) return;
      if (openAnimationInProgressSv.value === 1) return;
      if (isClosing.value) return;
      const sh = screenHeightSv.value;
      const sw = screenWidthSv.value;
      const availableHeight = sh - panelH;
      const centerY = availableHeight / 2;
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

  useEffect(() => {
    if (__DEV__) {
      console.log('[Image:Perf] actions context recreated #', actionsRecreateCountRef.current);
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
    const hasPanel = !!state.activeOverlayPost;
    const availableHeight = hasPanel
      ? actions.screenHeight * (1 - BOTTOM_PANEL_MAX_HEIGHT_FRACTION)
      : actions.screenHeight;
    // Max viewport so each image fits independently (contentFit="contain")
    const expandedWidth = actions.screenWidth;
    const expandedHeight = availableHeight;
    return {
      ...actions,
      ...state,
      expandedWidth,
      expandedHeight,
    };
  }, [state, actions]);
}

export const IMAGE_OVERLAY_TIMING_CONFIG = TIMING_CONFIG;
