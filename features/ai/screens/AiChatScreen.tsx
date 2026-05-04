import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import Reanimated, { useAnimatedStyle, useDerivedValue, runOnJS } from 'react-native-reanimated';
import {
  KeyboardAvoidingView,
  useKeyboardState,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { LegendList } from '@legendapp/list';
import { useRoutstrStore, type RoutstrMessage } from '@/shared/stores/profile/routstrStore';
import { ChatComposer } from '@/shared/ui/composed/chat/ChatComposer';
import { View } from '@/shared/ui/primitives/View/View';
import { useBackgroundConfig } from '@/shared/providers/BackgroundProvider';
import { aiLog, useLifecycleLogger } from '@/shared/lib/logger';
import { ModelChip } from '../components/ModelChip';
import { AiEmptyState } from '../components/AiEmptyState';
import { AiMessageBubble, type BranchNav } from '../components/AiMessageBubble';
import { useAiSend } from '../hooks/useAiSend';
import { deriveActivePath, getSiblingInfo, withSynthesisedParents } from '../lib/branching';

// Stable config — referential identity matters for useBackgroundConfig deps.
// `full` matches HomeFeed.tsx so the AI tab inherits the same background
// treatment as Feed (and therefore Contacts, which doesn't set its own and
// inherits whichever sibling last focused).
const BG_CONFIG = { blurMode: 'full' as const };

// Visual gap between the bubble and either the tab bar (closed state) or
// the keyboard (open state). Same value on both sides so the bubble feels
// stable when the keyboard rises/falls.
const BUBBLE_GAP = 4;

export function AiChatScreen() {
  useLifecycleLogger('AiChatScreen');
  useBackgroundConfig(BG_CONFIG);

  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  // Provided by React Navigation's `<Tabs>` (the Android / pre-iOS-26
  // fallback). On iOS native tabs the context is absent → 0, and the
  // floating tab bar is already counted inside `insets.bottom` by the
  // LiquidGlass content view.
  const reactNavTabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;

  const [text, setText] = useState('');
  const conversationHistory = useRoutstrStore((s) => s.conversationHistory);
  const activeChildren = useRoutstrStore((s) => s.activeChildren);
  const setActiveBranch = useRoutstrStore((s) => s.setActiveBranch);

  const { send, retry, isSending, streamingMessageId } = useAiSend();

  // Active path = the branch of the conversation tree the user is currently
  // looking at. Derived from the flat persisted array + the per-parent
  // active-child pointer. Re-derives only when either input identity
  // changes, which is exactly when the rendered chat needs to update.
  const activeMessages = useMemo(
    () => deriveActivePath(conversationHistory, activeChildren),
    [conversationHistory, activeChildren]
  );

  // Sibling info per active message, computed once per render so each
  // bubble can render its `←  N / M  →` widget without re-walking the
  // flat array. Only assistant messages with siblings get an entry.
  const branchNavById = useMemo(() => {
    const map = new Map<string, BranchNav>();
    const normalized = withSynthesisedParents(conversationHistory);
    for (const m of activeMessages) {
      if (m.role !== 'assistant') continue;
      const info = getSiblingInfo(m.id, normalized);
      if (!info) continue;
      const onPrev =
        info.index > 1
          ? () => setActiveBranch(m.parentId ?? '', info.siblings[info.index - 2].id)
          : undefined;
      const onNext =
        info.index < info.total
          ? () => setActiveBranch(m.parentId ?? '', info.siblings[info.index].id)
          : undefined;
      map.set(m.id, { index: info.index, total: info.total, onPrev, onNext });
    }
    return map;
  }, [activeMessages, conversationHistory, setActiveBranch]);

  // ─── Keyboard transitions ──────────────────────────────────────────────
  // `useKeyboardState` returns a JS-thread snapshot — fine for transition
  // logging (a couple events per show/hide). The frame-by-frame animation
  // values stay on the UI thread via `useReanimatedKeyboardAnimation`
  // below; we log those separately via `useDerivedValue` + `runOnJS` so
  // we get one entry per direction change instead of one per frame.
  const kbState = useKeyboardState();
  const kbStateRef = useRef({ isVisible: false, height: 0 });
  useEffect(() => {
    const prev = kbStateRef.current;
    if (prev.isVisible === kbState.isVisible && prev.height === kbState.height) return;
    aiLog.info('ai.kav.keyboard_state', {
      from: { isVisible: prev.isVisible, height: prev.height },
      to: { isVisible: kbState.isVisible, height: kbState.height },
    });
    kbStateRef.current = { isVisible: kbState.isVisible, height: kbState.height };
  }, [kbState.isVisible, kbState.height]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    aiLog.info('ai.send.dispatch', {
      textLen: trimmed.length,
      historyCount: conversationHistory.length,
      activeCount: activeMessages.length,
      kbVisible: kbState.isVisible,
      kbHeight: kbState.height,
    });
    setText('');
    void send(trimmed);
  }, [
    send,
    text,
    conversationHistory.length,
    activeMessages.length,
    kbState.isVisible,
    kbState.height,
  ]);

  const handleRetry = useCallback(
    (messageId: string) => {
      aiLog.info('ai.retry.dispatch', { messageId });
      void retry(messageId);
    },
    [retry]
  );

  const renderItem = useCallback(
    ({ item }: { item: RoutstrMessage }) => (
      <AiMessageBubble
        message={item}
        isStreaming={item.id === streamingMessageId}
        // Disable retry while *any* message is streaming — switching mid-flight
        // would orphan the in-flight placeholder and corrupt the active path.
        onRetry={isSending ? undefined : handleRetry}
        branchNav={branchNavById.get(item.id)}
      />
    ),
    [streamingMessageId, isSending, handleRetry, branchNavById]
  );

  const isEmpty = activeMessages.length === 0;

  // Stack header is `headerTransparent: true`, so the LegendList renders
  // behind it. Pad the top of the scroll content by the measured header
  // height so old messages can scroll fully into view instead of being
  // clipped under the floating header.
  const listPaddingTop = headerHeight + 8;

  // Reanimated keyboard animation: `progress` goes 0 → 1 on the UI thread,
  // synced with the system keyboard's animation curve. We interpolate the
  // composer's bottom padding between its closed-state value (clear the
  // tab bar + home indicator) and its open-state value (just the 4px gap)
  // so the bubble tracks the keyboard top in real time. The previous
  // approach (`useKeyboardState` JS boolean) was JS-thread, so the padding
  // only flipped after the native animation finished — visible as a
  // delayed snap.
  const { progress } = useReanimatedKeyboardAnimation();
  const closedPadding = insets.bottom + reactNavTabBarHeight + BUBBLE_GAP;
  const openPadding = BUBBLE_GAP;

  // Log the inputs to the Reanimated formula whenever they change. The
  // animation itself runs on the UI thread, but the inputs come from JS
  // (insets, tab bar context) — having them on the timeline lets us
  // replay the exact paddingBottom curve from log-doctor without needing
  // per-frame samples.
  useEffect(() => {
    aiLog.info('ai.kav.padding_inputs', {
      closedPadding,
      openPadding,
      bubbleGap: BUBBLE_GAP,
      headerHeight,
      insetsBottom: insets.bottom,
      reactNavTabBarHeight,
      listPaddingTop,
    });
  }, [
    closedPadding,
    openPadding,
    headerHeight,
    insets.bottom,
    reactNavTabBarHeight,
    listPaddingTop,
  ]);

  // Bridge the UI-thread `progress` value back to JS for transition logging.
  // We only forward when the rounded value crosses a 0.05 threshold, so we
  // get ~20 samples per show/hide animation rather than one per frame.
  // `useDerivedValue` runs on the UI thread (cheap); `runOnJS` schedules a
  // microtask to JS — same pattern Reanimated docs recommend for telemetry.
  const lastReportedProgress = useRef(0);
  const reportProgress = useCallback(
    (p: number) => {
      aiLog.debug('ai.kav.progress_tick', {
        progress: p,
        paddingBottom: closedPadding + (openPadding - closedPadding) * p,
        closedPadding,
        openPadding,
      });
    },
    [closedPadding, openPadding]
  );
  useDerivedValue(() => {
    'worklet';
    const p = progress.value;
    const rounded = Math.round(p * 20) / 20; // 0.05 buckets

    if (rounded !== lastReportedProgress.current) {
      lastReportedProgress.current = rounded;
      runOnJS(reportProgress)(rounded);
    }
  }, [reportProgress]);

  const composerWrapperStyle = useAnimatedStyle(() => {
    'worklet';
    const p = progress.value;
    return {
      paddingBottom: closedPadding + (openPadding - closedPadding) * p,
    };
  }, [closedPadding, openPadding]);

  // ─── List perf instrumentation ──────────────────────────────────────────
  // A tight handful of events: layout (one-shot per orientation), content
  // size (fires when messages are added — measures whether the list is
  // taller than the viewport, which is what `maintainScrollAtEnd` keys
  // off), and a scroll handler that filters to "near-end-or-not" so we
  // can see when the auto-lock to the bottom actually catches.
  const listLayoutRef = useRef<{ height: number; width: number } | null>(null);
  // Typed loosely on purpose — `@legendapp/list`'s onLayout/onScroll prop
  // types ship a re-export of RN's event types that doesn't unify with
  // the one from `react-native` direct, so the precise types fight us.
  const handleListLayout = useCallback((e: LayoutChangeEvent | any) => {
    const { width, height } = (e as LayoutChangeEvent).nativeEvent.layout;
    const last = listLayoutRef.current;
    if (last && Math.abs(last.width - width) < 0.5 && Math.abs(last.height - height) < 0.5) {
      return;
    }
    listLayoutRef.current = { width, height };
    aiLog.info('ai.list.layout', {
      width: Math.round(width),
      height: Math.round(height),
    });
  }, []);

  const listContentSizeRef = useRef<{ w: number; h: number } | null>(null);
  const handleListContentSize = useCallback(
    (w: number, h: number) => {
      const last = listContentSizeRef.current;
      if (last && Math.abs(last.w - w) < 0.5 && Math.abs(last.h - h) < 0.5) return;
      const viewportH = listLayoutRef.current?.height ?? 0;
      listContentSizeRef.current = { w, h };
      aiLog.debug('ai.list.content_size', {
        contentW: Math.round(w),
        contentH: Math.round(h),
        viewportH: Math.round(viewportH),
        overflow: Math.round(h - viewportH),
        msgsCount: conversationHistory.length,
      });
    },
    [conversationHistory.length]
  );

  const lastScrollLogRef = useRef(0);
  const handleListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent> | any) => {
    const now = Date.now();
    // Hard-throttle: at most one log per 120ms — without this the JSON
    // dump is unreadable and we breach the 15% noise threshold immediately.
    if (now - lastScrollLogRef.current < 120) return;
    lastScrollLogRef.current = now;
    const { contentOffset, contentSize, layoutMeasurement } = (
      e as NativeSyntheticEvent<NativeScrollEvent>
    ).nativeEvent;
    const distFromEnd = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    aiLog.debug('ai.list.scroll', {
      offsetY: Math.round(contentOffset.y),
      contentH: Math.round(contentSize.height),
      viewportH: Math.round(layoutMeasurement.height),
      distFromEnd: Math.round(distFromEnd),
    });
  }, []);

  // Track conversation length transitions so the "weird animation when we
  // add a message" the user described is correlated with what actually
  // changed — and on which side (user vs assistant).
  const prevHistoryRef = useRef({ count: 0, lastId: '', lastRole: '' });
  useEffect(() => {
    const prev = prevHistoryRef.current;
    const last = conversationHistory[conversationHistory.length - 1];
    const nextSnapshot = {
      count: conversationHistory.length,
      lastId: last?.id ?? '',
      lastRole: last?.role ?? '',
    };
    if (
      nextSnapshot.count !== prev.count ||
      nextSnapshot.lastId !== prev.lastId ||
      nextSnapshot.lastRole !== prev.lastRole
    ) {
      aiLog.info('ai.list.history_change', {
        prevCount: prev.count,
        count: nextSnapshot.count,
        delta: nextSnapshot.count - prev.count,
        lastRole: nextSnapshot.lastRole,
        lastIdChanged: nextSnapshot.lastId !== prev.lastId,
        streamingMessageId,
      });
      prevHistoryRef.current = nextSnapshot;
    }
  }, [conversationHistory, streamingMessageId]);

  return (
    // KAV with `behavior="padding"` and `keyboardVerticalOffset={0}` adds
    // exactly `keyboardHeight` of bottom padding (animated natively). The
    // LegendList shrinks by that amount so its last row stays above the
    // keyboard. The composer's intrinsic padding is animated in parallel
    // via Reanimated so the bubble visual lands exactly `BUBBLE_GAP` above
    // the keyboard top throughout the animation, not just at the end.
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0} style={{ flex: 1 }}>
      <View style={{ flex: 1 }} testID="screen-ai-chat">
        <View collapsable={false} style={{ flex: 1 }}>
          {isEmpty ? (
            <Pressable
              onPress={Keyboard.dismiss}
              style={{ flex: 1, paddingTop: listPaddingTop }}
              accessible={false}
              importantForAccessibility="no">
              <AiEmptyState />
            </Pressable>
          ) : (
            <LegendList
              data={activeMessages}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              estimatedItemSize={80}
              initialScrollAtEnd
              maintainScrollAtEnd
              maintainScrollAtEndThreshold={0.2}
              alignItemsAtEnd
              recycleItems={false}
              style={{ flex: 1 }}
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingTop: listPaddingTop,
                paddingBottom: 12,
              }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              onLayout={handleListLayout}
              onContentSizeChange={handleListContentSize}
              onScroll={handleListScroll}
              scrollEventThrottle={120}
            />
          )}
        </View>

        <Reanimated.View collapsable={false} style={composerWrapperStyle}>
          <ChatComposer
            value={text}
            onChangeText={setText}
            onSend={handleSend}
            disabled={isSending}
            placeholder="Ask anything"
            actionsLeading={<ModelChip />}
            // Outer wrapper above owns the dynamic bottom padding (animated
            // by Reanimated). Set the composer's own bottomPadding to 0 so
            // it doesn't double-add.
            bottomPadding={0}
            testID="ai-input"
            surface="ai"
          />
        </Reanimated.View>
      </View>
    </KeyboardAvoidingView>
  );
}
