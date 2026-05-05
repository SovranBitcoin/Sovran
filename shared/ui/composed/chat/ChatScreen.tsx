import React, { useCallback, useState } from 'react';
import { LegendList } from '@legendapp/list';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useHeaderHeight } from '@react-navigation/elements';

import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { Log } from '@/shared/lib/logger';
import type { Logger } from '@/shared/lib/logger';

import { ChatComposer } from './ChatComposer';
import { ChatMessageBubble } from './ChatMessageBubble';
import { useChatSurfacePerfLogger } from './useChatSurfacePerfLogger';
import { useMessageGrouping } from './useMessageGrouping';
import type { ChatBubbleMessage } from './types';

interface ChatScreenProps {
  /**
   * Diagnostic name for the wrapping `<Log>` boundary and the perf-logger
   * `surface` tag. log-doctor `--event chat.*` filters use this to split
   * timings per transport (`nostr-dm`, `whitenoise`, `bitchat-nostr`, …).
   */
  surface: string;
  /** Scoped logger that owns this surface's chat.* events. */
  log: Logger;
  /**
   * Header rendered above the message list. DM surfaces pass
   * `<DmChatHeader …/>`; non-DM surfaces (e.g. geohash public) pass their
   * own `<Stack.Screen options=…/>`. Either way ChatScreen does not enforce
   * a header shape — the only contract is that the consumer paints the
   * navigation header before the list mounts.
   */
  header: React.ReactNode;
  /**
   * Bubble messages already adapted from the surface's domain shape. Same
   * array drives both the LegendList and the message-grouping map.
   */
  messages: ChatBubbleMessage[];
  /**
   * Send dispatcher. Receives the trimmed message text. ChatScreen wraps
   * this in `useSingleFlight` and emits the canonical `chat.send.dispatch
   * / .complete / .failed` events automatically — the consumer only owns
   * the publish/optimistic-bubble/error-popup logic.
   */
  onSend: (text: string) => Promise<unknown> | unknown;
  /**
   * Disable the send button (and ignore Enter taps). Use for transports
   * that have a transient unavailable state (e.g. White Noise group not
   * yet created, BitChat scanning).
   */
  composerDisabled?: boolean;
  composerPlaceholder?: string;
  composerLeadingIcon?: string;
  composerLeadingIconNode?: React.ReactNode;
  composerActionsLeading?: React.ReactNode;
  composerTestID?: string;
  /** Banner content rendered inside the list area, above the LegendList. */
  banner?: React.ReactNode;
  /** Loading placeholder rendered in place of the LegendList when truthy. */
  isLoading?: boolean;
  loadingContent?: React.ReactNode;
  /** Empty-state node for the LegendList. */
  emptyContent?: React.ReactNode;
  /** Bottom padding when the list has content. Defaults to 16. */
  contentBottomPadding?: number;
  /** Avatar slots threaded into every ChatMessageBubble. */
  ownAvatar?: React.ReactNode;
  counterpartyAvatar?: React.ReactNode | null;
  /** Optional historyExtras / kbStateExtras passed straight to the perf logger. */
  historyExtras?: (last: ChatBubbleMessage | undefined) => Record<string, unknown>;
  kbStateExtras?: () => Record<string, unknown>;
}

/**
 * Screen-shaped wrapper that consolidates the chat surface scaffolding
 * (KeyboardAvoidingView, message-list, perf-logger, single-flight,
 * `chat.send.*` logging, composer). Three near-identical screens
 * (UserMessagesScreen, WhitenoiseDMScreen, GeohashChatScreen) used to
 * duplicate this block. Per audit 49-F-026 / 64-F-003 / 64-F-004 the seams
 * the consumer actually owns are the data hook, the bubble adapter, the
 * header, and a few composer slots — everything else lives here.
 */
export function ChatScreen({
  surface,
  log,
  header,
  messages,
  onSend,
  composerDisabled,
  composerPlaceholder,
  composerLeadingIcon,
  composerLeadingIconNode,
  composerActionsLeading,
  composerTestID,
  banner,
  isLoading,
  loadingContent,
  emptyContent,
  contentBottomPadding = 16,
  ownAvatar,
  counterpartyAvatar,
  historyExtras,
  kbStateExtras,
}: ChatScreenProps) {
  const headerHeight = useHeaderHeight();
  const surfaceColor = useThemeColor('surface');

  const [draft, setDraft] = useState('');

  const { handleListLayout, handleListContentSize, handleListScroll } = useChatSurfacePerfLogger({
    log,
    surface,
    headerHeight,
    messages,
    historyExtras,
    kbStateExtras,
  });

  const groupingMap = useMessageGrouping(messages);

  const renderMessage = useCallback(
    ({ item }: { item: ChatBubbleMessage }) => {
      const group = groupingMap.get(item.id);
      return (
        <ChatMessageBubble
          message={item}
          isFirstInGroup={group?.isFirst ?? true}
          isLastInGroup={group?.isLast ?? true}
          counterpartyAvatar={counterpartyAvatar}
          ownAvatar={ownAvatar}
        />
      );
    },
    [groupingMap, counterpartyAvatar, ownAvatar]
  );

  // Single-flight guards a rapid double-tap on the composer (the consumer's
  // `composerDisabled` is React state and can be stale by one frame). Same
  // pattern the three screens used to repeat individually.
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

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
      style={{ flex: 1 }}>
      <Log name={`ChatScreen:${surface}`}>
        {header}
        <View style={{ flex: 1, backgroundColor: surfaceColor }}>
          {banner}
          {isLoading ? (
            (loadingContent ?? null)
          ) : (
            <LegendList
              data={messages}
              onLayout={handleListLayout}
              onContentSizeChange={handleListContentSize}
              onScroll={handleListScroll}
              scrollEventThrottle={120}
              renderItem={renderMessage}
              keyExtractor={(item: ChatBubbleMessage) => item.id}
              initialScrollAtEnd
              maintainScrollAtEnd
              maintainScrollAtEndThreshold={0.2}
              alignItemsAtEnd
              estimatedItemSize={80}
              recycleItems={false}
              style={{ flex: 1 }}
              contentContainerStyle={
                messages.length === 0
                  ? { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 16 }
                  : { padding: 16, paddingBottom: contentBottomPadding }
              }
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              ListEmptyComponent={emptyContent ? <>{emptyContent}</> : null}
            />
          )}

          <ChatComposer
            value={draft}
            onChangeText={setDraft}
            onSend={handleSubmit}
            disabled={composerDisabled}
            placeholder={composerPlaceholder}
            leadingIcon={composerLeadingIcon}
            leadingIconNode={composerLeadingIconNode}
            actionsLeading={composerActionsLeading}
            testID={composerTestID}
            surface={surface}
          />
        </View>
      </Log>
    </KeyboardAvoidingView>
  );
}
