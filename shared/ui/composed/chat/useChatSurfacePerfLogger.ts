import { useCallback, useEffect, useRef } from 'react';
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';
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
