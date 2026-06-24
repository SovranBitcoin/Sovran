import { useCallback, useEffect, useRef } from 'react';
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import {
  useKeyboardHandler,
  useKeyboardState,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import { runOnJS, useAnimatedReaction, useSharedValue } from 'react-native-reanimated';
import type { Logger } from '@/shared/lib/logger';

interface ChatSurfaceMessage {
  id: string;
}

interface UseChatSurfacePerfLoggerOptions<TMessage extends ChatSurfaceMessage> {
  log: Logger;
  surface: string;
  headerHeight: number;
  messages: readonly TMessage[];
  /** Optional extra fields appended to every `chat.kav.keyboard_state` emit. */
  kbStateExtras?: () => Record<string, unknown>;
  /** Optional extra fields derived from the most-recent message on every
   *  `chat.list.history_change` emit. Receives `undefined` when the list is empty. */
  historyExtras?: (last: TMessage | undefined) => Record<string, unknown>;
}

interface UseChatSurfacePerfLoggerResult {
  handleListLayout: (e: LayoutChangeEvent | unknown) => void;
  handleListContentSize: (w: number, h: number) => void;
  handleListScroll: (e: NativeSyntheticEvent<NativeScrollEvent> | unknown) => void;
}

/**
 * Shared chat-surface perf instrumentation. Emits the canonical
 * `chat.kav.keyboard_state`, `chat.list.layout`, `chat.list.content_size`,
 * `chat.list.scroll`, and `chat.list.history_change` events with stable
 * payload shapes so log-doctor's `--event chat.kav|chat.list` filter spans
 * every chat surface uniformly.
 *
 * Surfaces pass their own scoped logger and surface tag. Optional
 * `kbStateExtras` / `historyExtras` carry per-surface fields without breaking
 * the canonical event names.
 */
export function useChatSurfacePerfLogger<TMessage extends ChatSurfaceMessage>(
  opts: UseChatSurfacePerfLoggerOptions<TMessage>
): UseChatSurfacePerfLoggerResult {
  const { log, surface, headerHeight, messages, kbStateExtras, historyExtras } = opts;

  const kbState = useKeyboardState();
  const kbStateRef = useRef({ isVisible: false, height: 0 });
  // Stash the latest extras factories in refs so dep arrays stay stable —
  // callers don't need to memoise them.
  const kbStateExtrasRef = useRef(kbStateExtras);
  kbStateExtrasRef.current = kbStateExtras;
  const historyExtrasRef = useRef(historyExtras);
  historyExtrasRef.current = historyExtras;

  useEffect(() => {
    const prev = kbStateRef.current;
    if (prev.isVisible === kbState.isVisible && prev.height === kbState.height) return;
    log.info('chat.kav.keyboard_state', {
      surface,
      from: { isVisible: prev.isVisible, height: prev.height },
      to: { isVisible: kbState.isVisible, height: kbState.height },
      headerHeight,
      ...(kbStateExtrasRef.current?.() ?? {}),
    });
    kbStateRef.current = { isVisible: kbState.isVisible, height: kbState.height };
  }, [kbState.isVisible, kbState.height, headerHeight, log, surface]);

  const listLayoutRef = useRef<{ height: number; width: number } | null>(null);
  const handleListLayout = useCallback(
    (e: LayoutChangeEvent | unknown) => {
      const { width, height } = (e as LayoutChangeEvent).nativeEvent.layout;
      const last = listLayoutRef.current;
      if (last && Math.abs(last.width - width) < 0.5 && Math.abs(last.height - height) < 0.5) {
        return;
      }
      listLayoutRef.current = { width, height };
      log.info('chat.list.layout', {
        surface,
        width: Math.round(width),
        height: Math.round(height),
      });
    },
    [log, surface]
  );

  const listContentSizeRef = useRef<{ w: number; h: number } | null>(null);
  const handleListContentSize = useCallback(
    (w: number, h: number) => {
      const last = listContentSizeRef.current;
      if (last && Math.abs(last.w - w) < 0.5 && Math.abs(last.h - h) < 0.5) return;
      const viewportH = listLayoutRef.current?.height ?? 0;
      listContentSizeRef.current = { w, h };
      log.debug('chat.list.content_size', {
        surface,
        contentW: Math.round(w),
        contentH: Math.round(h),
        viewportH: Math.round(viewportH),
        overflow: Math.round(h - viewportH),
        msgsCount: messages.length,
      });
    },
    [log, surface, messages.length]
  );

  const lastScrollLogRef = useRef(0);
  const handleListScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent> | unknown) => {
      const now = Date.now();
      if (now - lastScrollLogRef.current < 120) return;
      lastScrollLogRef.current = now;
      const { contentOffset, contentSize, layoutMeasurement } = (
        e as NativeSyntheticEvent<NativeScrollEvent>
      ).nativeEvent;
      log.debug('chat.list.scroll', {
        surface,
        offsetY: Math.round(contentOffset.y),
        contentH: Math.round(contentSize.height),
        viewportH: Math.round(layoutMeasurement.height),
        distFromEnd: Math.round(contentSize.height - (contentOffset.y + layoutMeasurement.height)),
      });
    },
    [log, surface]
  );

  const prevMsgRef = useRef({ count: 0, lastId: '' });
  useEffect(() => {
    const prev = prevMsgRef.current;
    const last = messages[messages.length - 1];
    const next = { count: messages.length, lastId: last?.id ?? '' };
    if (next.count === prev.count && next.lastId === prev.lastId) return;
    log.info('chat.list.history_change', {
      surface,
      prevCount: prev.count,
      count: next.count,
      delta: next.count - prev.count,
      ...(historyExtrasRef.current?.(last) ?? {}),
    });
    prevMsgRef.current = next;
  }, [messages, log, surface]);

  return { handleListLayout, handleListContentSize, handleListScroll };
}

interface UseChatKeyboardAnimationLoggerOptions {
  log: Logger;
  surface: string;
}

/**
 * Per-frame keyboard animation telemetry. Mounts BOTH lower-level
 * primitives the keyboard-controller library exposes for animations
 * and counts how many per-frame samples each delivers during one
 * show/hide cycle. By logging both side-by-side we can tell whether
 * a "snap" originates in `useKeyboardHandler.onMove` (the events bus
 * that fires from `keyboardWillChangeFrame` notifications), in
 * `useReanimatedKeyboardAnimation`'s SharedValue stream (which is
 * driven by a separate iOS code path — keyboard layout-guide
 * observation), or in iOS itself (the keyboard skipped the
 * animation entirely).
 *
 * Three log events per show/hide cycle:
 *
 *   - `chat.kb.anim.start` — animation began (target height + ts).
 *
 *   - `chat.kb.anim.end` — animation finished. Carries:
 *       * `direction`: 'open' | 'close' (derived from target height)
 *       * `start_height`, `end_height`: in points (NOTE: these are
 *         the *target* height the keyboard is animating to, not the
 *         current frame — onStart and onEnd both report the target,
 *         so they're equal; `direction` is what disambiguates)
 *       * `duration_ms`: wall-clock time from `onStart` to `onEnd`
 *       * `move_count`: number of `onMove` worklet fires
 *       * `moves_per_sec`: rate
 *       * `progress_tick_count`: number of distinct `progress`
 *         SharedValue changes observed (the OTHER primitive)
 *       * `progress_min` / `progress_max`: the min/max progress
 *         values observed during the cycle (smooth = full 0→1 sweep,
 *         snap = both ends close together)
 *       * `interactive_count`: `onInteractive` fires (swipe-dismiss)
 *       * `smooth`: heuristic, true when `move_count >= 5`
 *
 * Read with log-doctor `--event chat.kb.anim.*`. Look for
 * `move_count` vs `progress_tick_count`:
 *
 *   - both low → iOS skipped the animation OR neither primitive is
 *     plumbed through (check KeyboardProvider mount + native build)
 *   - move_count low, progress_tick_count high → use
 *     `useReanimatedKeyboardAnimation` to drive the composer; KSV
 *     internally already does, so KSV should be smooth — issue
 *     elsewhere
 *   - move_count high, progress_tick_count low → switch animations
 *     off the progress primitive and onto useKeyboardHandler
 *   - both high → primitives are fine; visual snap is from
 *     unrelated React layout pressure during the animation
 */
export function useChatKeyboardAnimationLogger({
  log,
  surface,
}: UseChatKeyboardAnimationLoggerOptions): void {
  // SharedValues keep state on the UI thread between worklet
  // invocations. JS-thread refs alone wouldn't survive across the
  // start→move→end sequence without crossing the bridge each call.
  const startTs = useSharedValue(0);
  const startHeight = useSharedValue(0);
  const moveCount = useSharedValue(0);
  const interactiveCount = useSharedValue(0);
  const lastMoveTs = useSharedValue(0);

  // Independent counters for `useReanimatedKeyboardAnimation`'s
  // progress SharedValue. `cycleActive` gates the counters so we
  // only count progress ticks that occur between an `onStart` and
  // its corresponding `onEnd`.
  const cycleActive = useSharedValue(0);
  const progressTickCount = useSharedValue(0);
  const progressMin = useSharedValue(1);
  const progressMax = useSharedValue(0);
  const heightMin = useSharedValue(0);
  const heightMax = useSharedValue(0);

  const { progress, height: animatedHeight } = useReanimatedKeyboardAnimation();

  // Reanimated reaction = UI-thread observer. Fires whenever
  // `progress.value` changes. Cheap because it stays on the UI
  // thread; only counts and updates SharedValues.
  useAnimatedReaction(
    () => ({ p: progress.value, h: animatedHeight.value }),
    (curr, prev) => {
      'worklet';
      if (cycleActive.value === 0) return;
      if (curr.p === prev?.p && curr.h === prev.h) return;
      progressTickCount.value += 1;
      if (curr.p < progressMin.value) progressMin.value = curr.p;
      if (curr.p > progressMax.value) progressMax.value = curr.p;
      if (curr.h < heightMin.value) heightMin.value = curr.h;
      if (curr.h > heightMax.value) heightMax.value = curr.h;
    },
    []
  );

  const reportStart = useCallback(
    (height: number, jsTs: number) => {
      log.info('chat.kb.anim.start', { surface, height, ts: jsTs });
    },
    [log, surface]
  );

  const reportEnd = useCallback(
    (
      endHeight: number,
      startHeightVal: number,
      durationMs: number,
      moves: number,
      interactives: number,
      progressTicks: number,
      pMin: number,
      pMax: number,
      hMin: number,
      hMax: number
    ) => {
      // `e.height` from useKeyboardHandler is the TARGET height, so
      // both onStart and onEnd report the same value. Direction
      // therefore comes from the target itself: target=0 means
      // closing, target>0 means opening.
      const target = startHeightVal;
      const direction = target > 0 ? 'open' : 'close';
      const movesPerSec = durationMs > 0 ? Math.round((moves / durationMs) * 1000 * 10) / 10 : 0;
      const progressTicksPerSec =
        durationMs > 0 ? Math.round((progressTicks / durationMs) * 1000 * 10) / 10 : 0;
      log.info('chat.kb.anim.end', {
        surface,
        direction,
        start_height: Math.round(startHeightVal),
        end_height: Math.round(endHeight),
        duration_ms: Math.round(durationMs),
        move_count: moves,
        moves_per_sec: movesPerSec,
        interactive_count: interactives,
        progress_tick_count: progressTicks,
        progress_ticks_per_sec: progressTicksPerSec,
        progress_min: Math.round(pMin * 1000) / 1000,
        progress_max: Math.round(pMax * 1000) / 1000,
        progress_span: Math.round((pMax - pMin) * 1000) / 1000,
        height_min: Math.round(hMin),
        height_max: Math.round(hMax),
        height_span: Math.round(hMax - hMin),
        // Heuristic: a smooth keyboard animation lasting ~250ms at 60Hz
        // produces ~15 onMove fires; a "snap" produces 0–2. Same idea
        // for progress_tick_count via the alternate primitive.
        smooth: moves >= 5,
        smooth_progress: progressTicks >= 5,
      });
    },
    [log, surface]
  );

  useKeyboardHandler(
    {
      onStart: (e) => {
        'worklet';
        const now = Date.now();
        startTs.value = now;
        startHeight.value = e.height;
        moveCount.value = 0;
        interactiveCount.value = 0;
        lastMoveTs.value = 0;
        // Reset progress observation window. Seed the min/max from
        // the current values so the first reaction fire isn't
        // counted as a delta from 0.
        progressTickCount.value = 0;
        progressMin.value = progress.value;
        progressMax.value = progress.value;
        heightMin.value = animatedHeight.value;
        heightMax.value = animatedHeight.value;
        cycleActive.value = 1;
        runOnJS(reportStart)(e.height, now);
      },
      onMove: (_e) => {
        'worklet';
        moveCount.value += 1;
        lastMoveTs.value = Date.now();
      },
      onInteractive: (_e) => {
        'worklet';
        interactiveCount.value += 1;
      },
      onEnd: (e) => {
        'worklet';
        cycleActive.value = 0;
        const duration = Date.now() - startTs.value;
        runOnJS(reportEnd)(
          e.height,
          startHeight.value,
          duration,
          moveCount.value,
          interactiveCount.value,
          progressTickCount.value,
          progressMin.value,
          progressMax.value,
          heightMin.value,
          heightMax.value
        );
      },
    },
    [reportStart, reportEnd]
  );
}
