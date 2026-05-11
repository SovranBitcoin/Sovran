import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  ScrollView,
  View as RNView,
  type LayoutChangeEvent,
} from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { LegendList } from '@legendapp/list';

import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { useRoutstrStore, type RoutstrMessage } from '@/shared/stores/profile/routstrStore';
import { LiquidChatComposer } from '@/shared/ui/composed/chat/LiquidChatComposer';
import {
  useChatKeyboardAnimationLogger,
  useChatSurfacePerfLogger,
} from '@/shared/ui/composed/chat/useChatSurfacePerfLogger';
import { aiLog, useLifecycleLogger } from '@/shared/lib/logger';
import { isExpo55NativeTabsSupported } from '@/navigation/nativeTabs';
import { ModelChip } from '../components/ModelChip';
import { AiEmptyState } from '../components/AiEmptyState';
import { AiMessageBubble, type BranchNav } from '../components/AiMessageBubble';
import { useAiSend } from '../hooks/useAiSend';
import { deriveActivePath, getSiblingInfo, withSynthesisedParents } from '../lib/branching';

const SURFACE = 'ai';

/** Visual gap between the composer's outer bottom edge and the keyboard top
 *  when focused. Matches the shared ChatScreen — 0pt reads as "the composer
 *  is sitting on the keyboard" instead of floating mid-air. */
const COMPOSER_FOCUSED_BOTTOM_GAP = 0;

/** Hint for LegendList's virtualization math. Measured AI bubbles run
 *  ~74pt for short user pills and 150–400pt for assistant blocks; 80 is
 *  closer to the short-bubble median than to the long-tail average. The
 *  value isn't load-bearing for correctness — only first-render scroll
 *  position accuracy — and LegendList recomputes once real layouts
 *  measure. */
const ESTIMATED_BUBBLE_HEIGHT = 80;

/**
 * AI tab chat surface. Bypasses the shared `<ChatScreen />` (GiftedChat /
 * inverted `FlatList`) because iOS 26 applies a uniform dim to any RN
 * `FlatList`/`VirtualizedList` mounted inside this tab's wrapper tree —
 * affects both inverted AND non-inverted lists, independent of
 * `UIScrollEdgeEffect`. LegendList's separate virtualization sidesteps the
 * dim, so the AI surface is built directly on it: ascending data,
 * `alignItemsAtEnd` for the chat-style bottom dock, `maintainScrollAtEnd`
 * for stay-at-latest on streaming append. The other chat surfaces (BitChat,
 * WhiteNoise, Nostr DM, geohash) live in `(user-flow)` modal stacks where
 * the dim doesn't reproduce, so they keep using the shared GiftedChat-based
 * `<ChatScreen />`.
 */
export function AiChatScreen() {
  useLifecycleLogger('AiChatScreen');

  // On AiChatScreen MOUNT (not every focus), archive any in-progress
  // conversation and start fresh. The surface stays mounted across tab
  // switches (LazyTabContent only mounts once per session), so this
  // effectively fires:
  //   • Cold start of the app
  //   • Account/profile switch (re-mounts the account-scoped tree)
  //   • Hard reload during development
  //
  // It does NOT fire when:
  //   • Switching tabs (Wallet → AI etc.) — screen stays mounted
  //   • Opening a popup (sessions menu, ModelChip dropdown) — focus
  //     changes but mount is preserved
  //   • Keyboard show/hide — same as above
  //
  // Earlier implementation used `useFocusEffect` and fired on every
  // re-focus, which wiped the conversation any time a popup closed —
  // user reported the obvious bug. Prior conversations remain accessible
  // via `openAiSessionsMenu` (the header-right clock icon).
  useEffect(() => {
    const store = useRoutstrStore.getState();
    if (store.conversationHistory.length === 0) return;
    aiLog.info('ai.session.auto_new_on_mount', {
      archivedCount: store.conversationHistory.length,
    });
    store.createSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insets = useSafeAreaInsets();
  // Two tab-bar paths, two different bottom-inset shapes:
  //   • NativeTabs (iOS 26+ liquid glass): real `UITabBarController` grows
  //     the screen's bottom safe-area inset to cover tab bar + home-indicator
  //     together. The composer sits at `bottom: insets.bottom` over a
  //     full-screen frame and lands flush above the bar.
  //   • SovranTabBar (older iOS / Android): JS tab bar that already absorbs
  //     the home-indicator inset itself. Pass 0 so the composer sits flush
  //     against the bar instead of floating above it.
  const bottomInset = isExpo55NativeTabsSupported() ? insets.bottom : 0;
  const headerHeight = useHeaderHeight();
  // The AI tab's stack header is non-transparent; pad the topmost bubble
  // down by the header height so it doesn't slide under the BalancePill.
  const topInset = headerHeight;

  const surfaceColor = useThemeColor('surface');

  const conversationHistory = useRoutstrStore((s) => s.conversationHistory);
  const activeChildren = useRoutstrStore((s) => s.activeChildren);
  const setActiveBranch = useRoutstrStore((s) => s.setActiveBranch);

  const { send, retry, isSending, streamingMessageId } = useAiSend();

  const activeMessages = useMemo(
    () => deriveActivePath(conversationHistory, activeChildren),
    [conversationHistory, activeChildren]
  );

  // Mount visibility — narrow set, fires once. No imperative
  // scroll-chase plumbing: `alignItemsAtEnd` docks short content to the
  // bottom, `maintainScrollAtEnd` keeps the user pinned during streaming
  // appends, and `waitForInitialLayout` + `initialScrollIndex` handles
  // the first paint for histories larger than the viewport. Earlier
  // attempts at setTimeout-based chasers landed mid-list when item
  // measurements settled async — fragile for streaming content. Trust
  // the library; reach for telemetry if behavior regresses.
  useEffect(() => {
    aiLog.info('ai.list.mount', {
      messageCount: activeMessages.length,
      bottomInset,
      topInset,
      estimatedItemSize: ESTIMATED_BUBBLE_HEIGHT,
    });
    return () => {
      aiLog.info('ai.list.unmount', {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const handleRetry = useCallback(
    (messageId: string) => {
      aiLog.info('ai.retry.dispatch', { messageId });
      void retry(messageId);
    },
    [retry]
  );

  // Composer state (draft + measured height for list bottom padding).
  const [draft, setDraft] = useState('');
  const [composerHeight, setComposerHeight] = useState(0);
  const handleComposerLayout = useCallback((e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.height;
    setComposerHeight((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));
  }, []);

  // Composer + list both ride the keyboard via a single shared translate
  // (UI thread, no Yoga re-layout per frame). The math:
  //
  //   translateY = keyboardHeight.value + keyboardProgress.value * (bottomInset - COMPOSER_FOCUSED_BOTTOM_GAP)
  //
  // `keyboardHeight` is the keyboard's animated pixel height; RNKC's convention is
  // *negative* when the keyboard is shown (negative translateY = up). At rest
  // it's 0, so translateY is 0. At fully open, it's roughly `-keyboardH`, plus
  // the `progress * bottomInset` term that brings the composer back DOWN by
  // `bottomInset` to close the gap from "bottomInset above keyboard top" → "0pt
  // above keyboard top" (flush). The same value is applied to a wrapper
  // around the LegendList so the latest message rises with the composer
  // instead of getting hidden behind the keyboard.
  //
  // Why this instead of `<KeyboardAvoidingView behavior="padding">`: in RN's
  // Yoga layout, `position: 'absolute', bottom: X` children are positioned
  // relative to the parent's border box, not its padding box — so the KAV's
  // added `paddingBottom` doesn't lift the absolutely-positioned composer.
  // Driving the lift via Reanimated's translateY sidesteps the issue and
  // keeps the work on the UI thread.
  const { progress: keyboardProgress, height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const keyboardLiftStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY:
          keyboardHeight.value +
          keyboardProgress.value * (bottomInset - COMPOSER_FOCUSED_BOTTOM_GAP),
      },
    ],
  }));

  const dispatchSend = useSingleFlight(async (text: string) => {
    const sendStart = performance.now();
    aiLog.info('chat.send.dispatch', {
      surface: SURFACE,
      textLen: text.length,
      historyCount: activeMessages.length,
    });
    try {
      await send(text);
      aiLog.info('chat.send.complete', {
        surface: SURFACE,
        duration_ms: Math.round((performance.now() - sendStart) * 100) / 100,
      });
    } catch (err) {
      aiLog.warn('chat.send.failed', {
        surface: SURFACE,
        duration_ms: Math.round((performance.now() - sendStart) * 100) / 100,
        err,
      });
      throw err;
    }
  });

  const handleSubmit = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void dispatchSend(text).catch(() => {
      // Errors already logged; consumer's onSend is expected to surface
      // user-visible feedback (popups/banners).
    });
  }, [draft, dispatchSend]);

  // Perf loggers — same canonical emits the shared ChatScreen produces, so
  // the AI surface stays observable in chat.kav.* and chat.list.history_change
  // dashboards. The logger only reads `id` off each message; passing the
  // raw `RoutstrMessage[]` is enough.
  useChatSurfacePerfLogger({
    log: aiLog,
    surface: SURFACE,
    headerHeight,
    messages: activeMessages,
  });
  useChatKeyboardAnimationLogger({ log: aiLog, surface: SURFACE });

  const renderItem = useCallback(
    ({ item }: { item: RoutstrMessage }) => (
      <RNView style={{ paddingHorizontal: 16 }}>
        <AiMessageBubble
          message={item}
          isStreaming={item.id === streamingMessageId}
          onRetry={isSending ? undefined : handleRetry}
          branchNav={branchNavById.get(item.id)}
        />
      </RNView>
    ),
    [streamingMessageId, isSending, handleRetry, branchNavById]
  );

  const keyExtractor = useCallback((m: RoutstrMessage) => m.id, []);

  // Tap-to-dismiss-keyboard on the empty placeholder mirrors the previous
  // behaviour. Mounted in place of the list when there are no messages; the
  // composer stays mounted over the top, ready to accept the first message.
  const emptyContent = useMemo(
    () => (
      <Pressable
        onPress={Keyboard.dismiss}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        accessible={false}
        importantForAccessibility="no">
        <AiEmptyState />
      </Pressable>
    ),
    []
  );

  // Pad bottom of the list so the newest bubble rests just above the
  // composer's top edge while the composer itself is absolutely positioned
  // over the chat — older bubbles slide *under* the composer's translucent
  // glass on scroll-up (the iMessage / Telegram bleed-under-input look).
  //
  // No `paddingTop` here, even though there's a nav header above. With
  // `headerTransparent: false` the screen scene already starts BELOW the
  // header, so content lays out in the available area without manual
  // top padding. Adding `paddingTop` increases the effective content
  // height and breaks `alignItemsAtEnd`'s "content < viewport → dock
  // to bottom" math (LegendList thinks content already fills the
  // viewport, skips the auto-bottom-padding, and content sits at the
  // top instead of the bottom).
  const listContentContainerStyle = useMemo(
    () => ({
      paddingBottom: composerHeight + bottomInset + 16,
    }),
    [composerHeight, bottomInset]
  );

  return (
    <RNView style={{ flex: 1, backgroundColor: surfaceColor }}>
      {/* List wrapper rides the keyboard via the same shared translate as
          the composer. When the keyboard opens, both shift up together so
          the latest message stays just above the composer instead of
          getting hidden behind the keyboard. */}
      <Reanimated.View style={[{ flex: 1 }, keyboardLiftStyle]}>
      {activeMessages.length === 0 ? (
        emptyContent
      ) : (
        <LegendList
          data={activeMessages}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          estimatedItemSize={ESTIMATED_BUBBLE_HEIGHT}
          // Canonical LegendList v3 chat pattern. Each prop addresses a
          // different dynamic-content concern:
          //
          // `initialScrollAtEnd` — v3-only convenience; initializes the
          //   list scrolled to the last item. Replaces the v2 dance of
          //   `initialScrollIndex={length-1}` + `waitForInitialLayout` +
          //   manual `scrollToEnd` chasers (LegendApp/legend-list#174).
          //
          // `alignItemsAtEnd` — docks short histories (content < viewport)
          //   to the bottom by adding top padding internally. Only works if
          //   we DON'T set our own `paddingTop` on `contentContainerStyle`.
          //
          // `maintainScrollAtEnd` — keeps the viewport pinned to the
          //   bottom when new content appends, as long as the user is
          //   within `maintainScrollAtEndThreshold * viewportHeight` of
          //   the end. Carries us through streaming token append for free
          //   (assistant content grows over seconds; no setTimeout chasers).
          //
          // `maintainVisibleContentPosition` — keeps the visible item
          //   anchored when items above the viewport resize or load (our
          //   async bubble-height measurements). Without it, late
          //   measurements above the viewport shift content downward and
          //   land the user mid-list instead of pinned to the latest.
          initialScrollAtEnd
          alignItemsAtEnd
          maintainScrollAtEnd
          maintainScrollAtEndThreshold={0.1}
          maintainVisibleContentPosition
          recycleItems
          contentContainerStyle={listContentContainerStyle}
        />
      )}
      </Reanimated.View>

      <Reanimated.View
        onLayout={handleComposerLayout}
        style={[
          { position: 'absolute', left: 0, right: 0, bottom: bottomInset },
          keyboardLiftStyle,
        ]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: 12,
            gap: 8,
            alignItems: 'center',
          }}
          style={{ flexGrow: 0 }}>
          <ModelChip />
        </ScrollView>
        <LiquidChatComposer
          value={draft}
          onChangeText={setDraft}
          onSend={handleSubmit}
          disabled={isSending}
          placeholder="Ask anything"
          testID="ai-input"
          surface={SURFACE}
        />
      </Reanimated.View>
    </RNView>
  );
}
