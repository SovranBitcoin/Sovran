/**
 * Provider for the in-thread link embed.
 *
 * Holds the single piece of embed state (`embedUrl`) plus the shared values
 * that drive the collapsible thread sheet, and exposes `open(url)` / `close()`.
 * The machinery is dormant until `open()` is called from a tapped link in the
 * target post — until then the sheet rests at `translateY: 0` and the thread
 * behaves exactly as before.
 *
 * The sheet has three snap points (slide-down distance from its resting top):
 * - `0` (expanded) — the full thread.
 * - `snapMiddle` — most of the web view revealed, thread as a bottom strip.
 * - `snapInline` — slid down until only the floating action bar remains.
 *
 * Derived opacities drive a crossfade: as the sheet leaves the expanded rest,
 * the in-sheet target footer fades out while the floating action bar fades in,
 * and the web view fades up.
 *
 * Mirrors the `ImageOverlayProvider` pattern (sibling `image-overlay/`).
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import {
  type SharedValue,
  clamp,
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { openExternalUrl } from '@/shared/lib/url';
import { feedLog, log } from '@/shared/lib/logger';
import { staticPopup } from '@/shared/lib/popup';
import {
  INLINE_ACTION_BAR_FALLBACK,
  INLINE_HANDLE_PEEK,
  MIDDLE_REVEAL_FRACTION,
  SHEET_SPRING,
  WEBVIEW_SCROLL_TO_INLINE,
} from './embedConstants';
import { embedHaptic } from './embedHaptics';
import { resolveEmbedTarget } from './linkRouting';

interface ThreadEmbedContextValue {
  /** Currently embedded URL, or null when no embed is active. */
  embedUrl: string | null;
  /** Open (or replace) the embed for `url` and collapse the thread sheet to the middle snap. */
  open: (url: string) => void;
  /** Called by the web view's scroll — scrolling down locks the sheet to the inline snap. */
  handleEmbedScroll: (offsetY: number) => void;
  /** Reports the measured floating action-bar height so the inline snap is exact. */
  setActionBarHeight: (height: number) => void;
  /** Sheet slide-down distance from its resting top (0 = at rest). */
  sheetTranslateY: SharedValue<number>;
  /** Derived 0→1 across the whole rest→inline range (drives the sheet's corner radius). */
  collapseProgress: SharedValue<number>;
  /** Web-view fade-in (0 at rest → 1 well before the middle snap). */
  embedOpacity: SharedValue<number>;
  /** Floating action-bar fade-in (0 at rest → 1 by the middle snap). */
  actionBarOpacity: SharedValue<number>;
  /** In-sheet target footer fade-out (1 at rest → 0 by the middle snap). */
  targetFooterOpacity: SharedValue<number>;
  /** Live thread-list scroll offset, fed by `ThreadView`'s onScroll. */
  scrollY: SharedValue<number>;
  /** Resting top of the sheet (px from screen top) — just above the first pfp/name. */
  expandedOffset: number;
  /** Slide distance to the MIDDLE snap. */
  snapMiddle: number;
  /** Slide distance to the INLINE snap (only the action bar remains). */
  snapInline: number;
  /** False while the sheet is dragged/collapsed, so the thread list doesn't
   *  scroll and the drag moves only the sheet. */
  listScrollEnabled: boolean;
}

const ThreadEmbedContext = createContext<ThreadEmbedContextValue | null>(null);

export function ThreadEmbedProvider({ children }: { children: React.ReactNode }) {
  const { height: screenHeight } = useWindowDimensions();
  // The sheet rests with its top just below the navigation header (i.e. just
  // above the first pfp/name), not at the very top of the screen.
  const expandedOffset = useHeaderHeight();
  const [actionBarHeight, setActionBarHeightState] = useState(INLINE_ACTION_BAR_FALLBACK);

  // Middle snap: most of the page revealed, thread as a bottom strip.
  const snapMiddle = useMemo(
    () => Math.max(160, Math.round(screenHeight * MIDDLE_REVEAL_FRACTION) - expandedOffset),
    [screenHeight, expandedOffset]
  );
  // Inline snap: slid down until only the floating action bar plus the drag
  // handle peeking just above it remain.
  const snapInline = useMemo(
    () =>
      Math.max(
        snapMiddle + 80,
        screenHeight - actionBarHeight - INLINE_HANDLE_PEEK - expandedOffset
      ),
    [screenHeight, actionBarHeight, expandedOffset, snapMiddle]
  );

  const [embedUrl, setEmbedUrl] = useState<string | null>(null);

  const sheetTranslateY = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const snapMiddleSv = useSharedValue(snapMiddle);
  const snapInlineSv = useSharedValue(snapInline);
  snapMiddleSv.value = snapMiddle;
  snapInlineSv.value = snapInline;

  const collapseProgress = useDerivedValue(() => {
    'worklet';
    return clamp(sheetTranslateY.value / Math.max(1, snapInlineSv.value), 0, 1);
  });
  // Web view appears early in the collapse so it's fully visible by the middle snap.
  const embedOpacity = useDerivedValue(() => {
    'worklet';
    return clamp(sheetTranslateY.value / Math.max(1, snapMiddleSv.value * 0.5), 0, 1);
  });
  // Action bar fades in (and the in-sheet footer fades out) over rest→middle,
  // so they crossfade rather than both showing at once.
  const actionBarOpacity = useDerivedValue(() => {
    'worklet';
    return clamp(sheetTranslateY.value / Math.max(1, snapMiddleSv.value), 0, 1);
  });
  const targetFooterOpacity = useDerivedValue(() => {
    'worklet';
    return 1 - actionBarOpacity.value;
  });

  // The list scrolls only when the sheet is fully expanded; otherwise a drag
  // moves the sheet alone (no double-scroll). Toggled at the boundary so the
  // JS-thread setState fires once per crossing, not per frame.
  const [listScrollEnabled, setListScrollEnabled] = useState(true);
  useAnimatedReaction(
    () => sheetTranslateY.value <= 1,
    (expanded, prev) => {
      if (expanded !== prev) runOnJS(setListScrollEnabled)(expanded);
    }
  );

  // Dragging the sheet back up to its resting position clears the embed (there
  // is no chrome close button). `hasCollapsed` guards the open transition, where
  // the sheet briefly sits at rest before springing down.
  const clearEmbed = useCallback(() => setEmbedUrl(null), []);
  const hasCollapsed = useSharedValue(false);
  useAnimatedReaction(
    () => sheetTranslateY.value,
    (ty) => {
      if (ty > 8) {
        if (!hasCollapsed.value) hasCollapsed.value = true;
      } else if (ty <= 1 && hasCollapsed.value) {
        hasCollapsed.value = false;
        runOnJS(clearEmbed)();
      }
    }
  );

  const open = useCallback(
    (url: string) => {
      const target = resolveEmbedTarget(url);
      if (target == null) {
        // Non-embeddable scheme (mailto:, tel:, malformed) — fall back to the
        // OS opener rather than loading a non-page into the web view.
        log.warn('feed.thread.embed.open_fallback');
        void openExternalUrl(url).then((result) => {
          if (result.isErr()) staticPopup('open-link-failed');
        });
        return;
      }
      feedLog.info('feed.thread.embed.open');
      embedHaptic();
      setEmbedUrl(target);
      sheetTranslateY.value = withSpring(snapMiddle, SHEET_SPRING);
    },
    [snapMiddle, sheetTranslateY]
  );

  const handleEmbedScroll = useCallback(
    (offsetY: number) => {
      // Scrolling the page down tucks the thread strip away to the inline snap.
      if (offsetY > WEBVIEW_SCROLL_TO_INLINE && sheetTranslateY.value < snapInline - 4) {
        embedHaptic();
        sheetTranslateY.value = withSpring(snapInline, SHEET_SPRING);
      }
    },
    [snapInline, sheetTranslateY]
  );

  const setActionBarHeight = useCallback((height: number) => {
    setActionBarHeightState((prev) => (Math.abs(prev - height) < 1 ? prev : height));
  }, []);

  const value = useMemo<ThreadEmbedContextValue>(
    () => ({
      embedUrl,
      open,
      handleEmbedScroll,
      setActionBarHeight,
      sheetTranslateY,
      collapseProgress,
      embedOpacity,
      actionBarOpacity,
      targetFooterOpacity,
      scrollY,
      expandedOffset,
      snapMiddle,
      snapInline,
      listScrollEnabled,
    }),
    [
      embedUrl,
      open,
      handleEmbedScroll,
      setActionBarHeight,
      sheetTranslateY,
      collapseProgress,
      embedOpacity,
      actionBarOpacity,
      targetFooterOpacity,
      scrollY,
      expandedOffset,
      snapMiddle,
      snapInline,
      listScrollEnabled,
    ]
  );

  return <ThreadEmbedContext.Provider value={value}>{children}</ThreadEmbedContext.Provider>;
}

/** Returns the embed controls, or null when rendered outside a provider. */
export function useThreadEmbed(): ThreadEmbedContextValue | null {
  return useContext(ThreadEmbedContext);
}
