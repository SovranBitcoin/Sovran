import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, View as RNView, type LayoutChangeEvent } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { GiftedChat, type IMessage, type InputToolbarProps } from 'react-native-gifted-chat';

import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { Log } from '@/shared/lib/logger';
import type { Logger } from '@/shared/lib/logger';

import { LiquidChatComposer } from './LiquidChatComposer';
import { ChatMessageBubble } from './ChatMessageBubble';
import {
  useChatKeyboardAnimationLogger,
  useChatSurfacePerfLogger,
} from './useChatSurfacePerfLogger';
import { useMessageGrouping } from './useMessageGrouping';
import type { ChatBubbleMessage } from './types';

interface ChatScreenProps {
  surface: string;
  log: Logger;
  header: React.ReactNode;
  messages: ChatBubbleMessage[];
  onSend: (text: string) => Promise<unknown> | unknown;
  composerDisabled?: boolean;
  composerPlaceholder?: string;
  composerOnPlusPress?: () => void;
  composerOnMoneyPress?: () => void;
  composerOnVoicePress?: () => void;
  /**
   * Optional row of action buttons rendered ABOVE the LiquidChatComposer
   * inside the same sticky container — so it rides up with the keyboard
   * exactly like the input. The consumer decides what to render; pass any
   * number of `<Button>`s (or a single one) and they'll lay out in a
   * horizontal scroll view that doesn't dismiss the keyboard on tap.
   * Use for surface-level shortcuts like "Send Money", "Attach", etc.
   */
  composerActions?: React.ReactNode;
  composerTestID?: string;
  banner?: React.ReactNode;
  isLoading?: boolean;
  loadingContent?: React.ReactNode;
  emptyContent?: React.ReactNode;
  contentBottomPadding?: number;
  ownAvatar?: React.ReactNode;
  counterpartyAvatar?: React.ReactNode | null;
  historyExtras?: (last: ChatBubbleMessage | undefined) => Record<string, unknown>;
  kbStateExtras?: () => Record<string, unknown>;
}

const OWN_USER_ID = 'me';

type GiftedMessage = IMessage & { __bubble: ChatBubbleMessage };

/**
 * Shared chat surface backed by `react-native-gifted-chat`. The list, keyboard
 * avoidance, and inverted scroll behaviour come from GiftedChat; we keep our
 * `LiquidChatComposer` (mounted via `renderInputToolbar`) and our
 * `ChatMessageBubble` (mounted via `renderMessage`) so each surface looks
 * identical to before. Public props are unchanged — the three DM consumers
 * (BitChat, WhiteNoise, Nostr DM) need no edits.
 */
export function ChatScreen({
  surface,
  log,
  header,
  messages,
  onSend,
  composerDisabled,
  composerPlaceholder,
  composerOnPlusPress,
  composerOnMoneyPress,
  composerOnVoicePress,
  composerActions,
  composerTestID,
  banner,
  isLoading,
  loadingContent,
  emptyContent,
  ownAvatar,
  counterpartyAvatar,
  historyExtras,
  kbStateExtras,
}: ChatScreenProps) {
  const headerHeight = useHeaderHeight();
  const surfaceColor = useThemeColor('surface');

  const [draft, setDraft] = useState('');

  // Measured composer height. Used to pad the FlatList's content so the
  // newest bubble rests just above the composer's top edge, while the
  // composer itself is absolutely positioned over the chat — older
  // bubbles slide *under* the composer's translucent glass on scroll-up
  // (the iMessage / Telegram bleed-under-input look).
  const [composerHeight, setComposerHeight] = useState(0);
  const handleComposerLayout = useCallback((e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.height;
    setComposerHeight((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));
  }, []);

  // Keep emitting the canonical chat.kav.keyboard_state / chat.list.history_change
  // events. List-layout / scroll handlers aren't wired because GiftedChat's
  // FlatList doesn't expose those hooks publicly.
  useChatSurfacePerfLogger({
    log,
    surface,
    headerHeight,
    messages,
    historyExtras,
    kbStateExtras,
  });
  useChatKeyboardAnimationLogger({ log, surface });

  const groupingMap = useMessageGrouping(messages);

  // GiftedChat expects newest-first. Source array is oldest-first.
  const giftedMessages = useMemo<GiftedMessage[]>(() => {
    const out: GiftedMessage[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      out.push({
        _id: m.id,
        text: m.content,
        createdAt: m.timestamp,
        user: { _id: m.isOwn ? OWN_USER_ID : m.senderId || 'peer', name: m.sender },
        __bubble: m,
      });
    }
    return out;
  }, [messages]);

  const dispatchSend = useSingleFlight(async (text: string) => {
    const sendStart = performance.now();
    log.info('chat.send.dispatch', {
      surface,
      textLen: text.length,
      historyCount: messages.length,
    });
    try {
      await onSend(text);
      log.info('chat.send.complete', {
        surface,
        duration_ms: Math.round((performance.now() - sendStart) * 100) / 100,
      });
    } catch (err) {
      log.warn('chat.send.failed', {
        surface,
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
      // Errors are already logged by dispatchSend; consumer's onSend is
      // expected to surface user-visible feedback (popups/banners).
    });
  }, [draft, dispatchSend]);

  const renderInputToolbar = useCallback(
    (_props: InputToolbarProps<GiftedMessage>) => (
      // Absolute over the chat body so messages can scroll *under* the
      // composer's translucent glass instead of clipping at a hard
      // cut-off line above it. The wrapper has no backgroundColor of
      // its own — only the LiquidChatComposer's inner glass capsules
      // do — so messages bleed through the gaps between them. Optional
      // action row sits inside this container so it rides the keyboard
      // animation in lock-step with the input bubble.
      <RNView
        onLayout={handleComposerLayout}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        {composerActions ? (
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
            {composerActions}
          </ScrollView>
        ) : null}
        <LiquidChatComposer
          value={draft}
          onChangeText={setDraft}
          onSend={handleSubmit}
          disabled={composerDisabled}
          placeholder={composerPlaceholder}
          onPlusPress={composerOnPlusPress}
          onMoneyPress={composerOnMoneyPress}
          onVoicePress={composerOnVoicePress}
          testID={composerTestID}
          surface={surface}
        />
      </RNView>
    ),
    [
      draft,
      handleSubmit,
      handleComposerLayout,
      composerActions,
      composerDisabled,
      composerPlaceholder,
      composerOnPlusPress,
      composerOnMoneyPress,
      composerOnVoicePress,
      composerTestID,
      surface,
    ]
  );

  // GiftedChat's `renderMessage` wraps the bubble with its own padding. We
  // reach into __bubble for the original ChatBubbleMessage so grouping +
  // cashu-token + delivery-status logic stays untouched.
  const renderMessage = useCallback(
    ({ currentMessage }: { currentMessage: GiftedMessage }) => {
      const bubble = currentMessage.__bubble;
      const group = groupingMap.get(bubble.id);
      return (
        <RNView style={{ paddingHorizontal: 16 }}>
          <ChatMessageBubble
            message={bubble}
            isFirstInGroup={group?.isFirst ?? true}
            isLastInGroup={group?.isLast ?? true}
            counterpartyAvatar={counterpartyAvatar}
            ownAvatar={ownAvatar}
          />
        </RNView>
      );
    },
    [groupingMap, counterpartyAvatar, ownAvatar]
  );

  return (
    <View style={{ flex: 1, backgroundColor: surfaceColor }}>
      <Log name={`ChatScreen:${surface}`}>
        {header}
        <View style={{ flex: 1 }}>
          {banner}
          {isLoading ? (
            (loadingContent ?? null)
          ) : messages.length === 0 && emptyContent ? (
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
              }}>
              {emptyContent}
            </View>
          ) : (
            <GiftedChat<GiftedMessage>
              messages={giftedMessages}
              user={{ _id: OWN_USER_ID }}
              renderInputToolbar={renderInputToolbar}
              renderMessage={renderMessage}
              renderAvatar={null}
              renderDay={() => null}
              renderTime={() => null}
              renderUsername={() => null}
              isUsernameVisible={false}
              isDayAnimationEnabled={false}
              minInputToolbarHeight={0}
              messageIdGenerator={() => `gc-${Date.now()}`}
              // The list is inverted, so `contentContainerStyle.paddingTop`
              // is the *visual bottom* padding — i.e. the gap between the
              // newest bubble and the composer's top edge. Without this,
              // the newest message would sit hidden behind the absolute
              // composer.
              listProps={{
                contentContainerStyle: {
                  paddingTop: composerHeight + 16,
                  paddingBottom: 10,
                },
              }}
              // GiftedChat's default KAV uses `behavior='translate-with-padding'`,
              // which translates the content up during the keyboard animation
              // and then swaps to `paddingTop` at `onEnd`. Combined with the
              // outer `overflow:'hidden'`, that swap leaves a visible ghost
              // band above the composer on focus/unfocus. Plain `padding`
              // just grows `paddingBottom` to the keyboard height — no
              // translate, no swap, no residual artifact.
              // `automaticOffset` lets the KAV measure its own screen
              // position via `viewPositionInWindow` so the navigation header
              // is accounted for.
              keyboardAvoidingViewProps={{
                behavior: 'padding',
                automaticOffset: true,
                keyboardVerticalOffset: 0,
              }}
              onSend={() => {}}
            />
          )}
        </View>
      </Log>
    </View>
  );
}
