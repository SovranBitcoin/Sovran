import React, { useCallback, useMemo } from 'react';
import { Keyboard } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useRoutstrStore, type RoutstrMessage } from '@/shared/stores/profile/routstrStore';
import { ChatScreen, type ChatBubbleMessage } from '@/shared/ui/composed/chat';
import { aiLog, useLifecycleLogger } from '@/shared/lib/logger';
import { isExpo55NativeTabsSupported } from '@/navigation/nativeTabs';
import { ModelChip } from '../components/ModelChip';
import { AiEmptyState } from '../components/AiEmptyState';
import { AiMessageBubble, type BranchNav } from '../components/AiMessageBubble';
import { useAiSend } from '../hooks/useAiSend';
import { deriveActivePath, getSiblingInfo, withSynthesisedParents } from '../lib/branching';

const SURFACE = 'ai';

/**
 * AI tab chat surface. Wraps the shared `<ChatScreen />` so the GiftedChat
 * list, liquid-glass composer, keyboard avoidance, and perf logging are
 * identical to the DM surfaces (BitChat, WhiteNoise, Nostr DM). The AI-
 * specific concerns — streaming, branching, retry, the bubble-less assistant
 * presentation — live in `<AiMessageBubble />`, which we mount via the
 * `renderBubble` override.
 */
export function AiChatScreen() {
  useLifecycleLogger('AiChatScreen');

  // Two tab-bar paths, two different bottom-inset shapes:
  //   • NativeTabs (iOS 26+ liquid glass): real `UITabBarController` grows
  //     the screen's bottom safe-area inset to cover tab bar + home-indicator
  //     together (~83pt on iPhone). The composer sits at `bottom: insets.bottom`
  //     over a full-screen frame and lands flush above the bar.
  //   • SovranTabBar (older iOS / Android): JS tab bar that already absorbs
  //     the home-indicator inset itself, and the screen frame ends at the
  //     bar's top. `insets.bottom` here still reports the window-level home
  //     indicator (~34pt), so using it would float the composer above the
  //     tab bar instead of flush against it. Pass 0 on this path — ChatScreen
  //     honors explicit 0 and skips its `safeAreaInsets.bottom` fallback.
  const insets = useSafeAreaInsets();
  const bottomInset = isExpo55NativeTabsSupported() ? insets.bottom : 0;
  // The AI tab's stack header is `headerTransparent: true` (the BalancePill
  // floats over the chat). Pad the chat list down by the header's height so
  // the topmost bubble doesn't slide under the pill on first paint.
  const topInset = useHeaderHeight();

  const conversationHistory = useRoutstrStore((s) => s.conversationHistory);
  const activeChildren = useRoutstrStore((s) => s.activeChildren);
  const setActiveBranch = useRoutstrStore((s) => s.setActiveBranch);

  const { send, retry, isSending, streamingMessageId } = useAiSend();

  const activeMessages = useMemo(
    () => deriveActivePath(conversationHistory, activeChildren),
    [conversationHistory, activeChildren]
  );

  // Lookup-by-id from the bubble shape back to the source RoutstrMessage —
  // needed inside `renderBubble`, which only sees `ChatBubbleMessage`. The
  // ChatScreen's id matches the RoutstrMessage id by construction.
  const routstrById = useMemo(() => {
    const map = new Map<string, RoutstrMessage>();
    for (const m of activeMessages) map.set(m.id, m);
    return map;
  }, [activeMessages]);

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

  // RoutstrMessage[] -> ChatBubbleMessage[] adapter. The shared bubble shape
  // doesn't carry assistant-only fields (reasoning, cost, branch) — those
  // stay on the RoutstrMessage and are read back inside `renderBubble`.
  const bubbleMessages = useMemo<ChatBubbleMessage[]>(
    () =>
      activeMessages.map((m) => ({
        id: m.id,
        content: m.content,
        senderId: m.role === 'user' ? '' : 'assistant',
        timestamp: m.timestamp,
        isOwn: m.role === 'user',
        deliveryStatus: m.role === 'user' ? (m.pending ? 'sending' : 'sent') : undefined,
      })),
    [activeMessages]
  );

  const handleRetry = useCallback(
    (messageId: string) => {
      aiLog.info('ai.retry.dispatch', { messageId });
      void retry(messageId);
    },
    [retry]
  );

  const handleSend = useCallback(
    async (text: string) => {
      aiLog.info('ai.send.dispatch', {
        textLen: text.length,
        historyCount: conversationHistory.length,
        activeCount: activeMessages.length,
      });
      await send(text);
    },
    [send, conversationHistory.length, activeMessages.length]
  );

  // Bubble-less assistant + filled-pill user, exactly the previous look —
  // just plumbed through ChatScreen's renderBubble seam instead of a
  // hand-rolled GiftedChat config.
  const renderBubble = useCallback(
    ({ message }: { message: ChatBubbleMessage }) => {
      const source = routstrById.get(message.id);
      if (!source) return null;
      return (
        <AiMessageBubble
          message={source}
          isStreaming={source.id === streamingMessageId}
          onRetry={isSending ? undefined : handleRetry}
          branchNav={branchNavById.get(source.id)}
        />
      );
    },
    [routstrById, streamingMessageId, isSending, handleRetry, branchNavById]
  );

  // Tap-to-dismiss-keyboard on the empty placeholder mirrors the previous
  // behaviour. Wrapping inside ChatScreen's `emptyContent` is enough — the
  // composer stays mounted underneath, ready to accept the first message.
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

  return (
    <ChatScreen
      surface={SURFACE}
      log={aiLog}
      messages={bubbleMessages}
      onSend={handleSend}
      composerDisabled={isSending}
      composerPlaceholder="Ask anything"
      composerActions={<ModelChip />}
      composerTestID="ai-input"
      bottomInset={bottomInset}
      topInset={topInset}
      renderBubble={renderBubble}
      counterpartyAvatar={null}
      emptyContent={emptyContent}
    />
  );
}
