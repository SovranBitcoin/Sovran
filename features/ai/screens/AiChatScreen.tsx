import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Keyboard, View as RNView, type LayoutChangeEvent } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { useHeaderHeight } from '@react-navigation/elements';
import {
  GiftedChat,
  type IMessage,
  type InputToolbarProps,
} from 'react-native-gifted-chat';
import { useRoutstrStore, type RoutstrMessage } from '@/shared/stores/profile/routstrStore';
import { ChatComposer } from '@/shared/ui/composed/chat/ChatComposer';
import { useChatKeyboardAnimationLogger } from '@/shared/ui/composed/chat/useChatSurfacePerfLogger';
import { View } from '@/shared/ui/primitives/View/View';
import { useBackgroundConfig } from '@/shared/providers/BackgroundProvider';
import { aiLog, useLifecycleLogger } from '@/shared/lib/logger';
import { ModelChip } from '../components/ModelChip';
import { AiEmptyState } from '../components/AiEmptyState';
import { AiMessageBubble, type BranchNav } from '../components/AiMessageBubble';
import { useAiSend } from '../hooks/useAiSend';
import { deriveActivePath, getSiblingInfo, withSynthesisedParents } from '../lib/branching';

const BG_CONFIG = { blurMode: 'full' as const };

const OWN_USER_ID = 'me';
const ASSISTANT_USER_ID = 'assistant';

type AiGiftedMessage = IMessage & { __routstr: RoutstrMessage };

export function AiChatScreen() {
  useLifecycleLogger('AiChatScreen');
  useBackgroundConfig(BG_CONFIG);

  const headerHeight = useHeaderHeight();

  const [text, setText] = useState('');

  // Composer height measured at runtime so the FlatList content can
  // pad underneath it — bubbles bleed under the composer's translucent
  // glass on scroll-up, matching the DM surfaces.
  const [composerHeight, setComposerHeight] = useState(0);
  const handleComposerLayout = useCallback((e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.height;
    setComposerHeight((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));
  }, []);
  const conversationHistory = useRoutstrStore((s) => s.conversationHistory);
  const activeChildren = useRoutstrStore((s) => s.activeChildren);
  const setActiveBranch = useRoutstrStore((s) => s.setActiveBranch);

  const { send, retry, isSending, streamingMessageId } = useAiSend();

  const activeMessages = useMemo(
    () => deriveActivePath(conversationHistory, activeChildren),
    [conversationHistory, activeChildren]
  );

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

  useChatKeyboardAnimationLogger({ log: aiLog, surface: 'ai' });

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

  // Map RoutstrMessage[] -> IMessage[], newest first (GiftedChat is inverted).
  const giftedMessages = useMemo<AiGiftedMessage[]>(() => {
    const out: AiGiftedMessage[] = [];
    for (let i = activeMessages.length - 1; i >= 0; i--) {
      const m = activeMessages[i];
      out.push({
        _id: m.id,
        text: m.content,
        createdAt: m.timestamp,
        user: { _id: m.role === 'user' ? OWN_USER_ID : ASSISTANT_USER_ID },
        __routstr: m,
      });
    }
    return out;
  }, [activeMessages]);

  const renderMessage = useCallback(
    ({ currentMessage }: { currentMessage: AiGiftedMessage }) => {
      const message = currentMessage.__routstr;
      return (
        <RNView style={{ paddingHorizontal: 16 }}>
          <AiMessageBubble
            message={message}
            isStreaming={message.id === streamingMessageId}
            onRetry={isSending ? undefined : handleRetry}
            branchNav={branchNavById.get(message.id)}
          />
        </RNView>
      );
    },
    [streamingMessageId, isSending, handleRetry, branchNavById]
  );

  const renderInputToolbar = useCallback(
    (_props: InputToolbarProps<AiGiftedMessage>) => (
      <RNView
        onLayout={handleComposerLayout}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <ChatComposer
          value={text}
          onChangeText={setText}
          onSend={handleSend}
          disabled={isSending}
          placeholder="Ask anything"
          actionsLeading={<ModelChip />}
          testID="ai-input"
          surface="ai"
        />
      </RNView>
    ),
    [text, handleSend, isSending, handleComposerLayout]
  );

  const isEmpty = activeMessages.length === 0;

  // Stack header is `headerTransparent: true`, so we still pad the chat area
  // by the measured header height to keep content from clipping under the
  // floating header.
  const listPaddingTop = headerHeight + 8;

  return (
    <View style={{ flex: 1 }} testID="screen-ai-chat">
      {isEmpty ? (
        <RNView style={{ flex: 1 }}>
          <Pressable
            onPress={Keyboard.dismiss}
            style={{ flex: 1, paddingTop: listPaddingTop }}
            accessible={false}
            importantForAccessibility="no">
            <AiEmptyState />
          </Pressable>
          <ChatComposer
            value={text}
            onChangeText={setText}
            onSend={handleSend}
            disabled={isSending}
            placeholder="Ask anything"
            actionsLeading={<ModelChip />}
            testID="ai-input"
            surface="ai"
          />
        </RNView>
      ) : (
        <GiftedChat<AiGiftedMessage>
          messages={giftedMessages}
          user={{ _id: OWN_USER_ID }}
          renderMessage={renderMessage}
          renderInputToolbar={renderInputToolbar}
          renderAvatar={null}
          renderDay={() => null}
          renderTime={() => null}
          renderUsername={() => null}
          isUsernameVisible={false}
          isDayAnimationEnabled={false}
          messagesContainerStyle={{ paddingTop: listPaddingTop }}
          minInputToolbarHeight={0}
          messageIdGenerator={() => `ai-${Date.now()}`}
          // Inverted FlatList: contentContainerStyle.paddingTop is the
          // *visual bottom* padding — it lifts the newest bubble above
          // the absolute composer so it isn't hidden behind it.
          listProps={{
            contentContainerStyle: {
              paddingTop: composerHeight + 16,
              paddingBottom: 10,
            },
          }}
          keyboardAvoidingViewProps={{
            behavior: 'padding',
            automaticOffset: true,
            keyboardVerticalOffset: 0,
          }}
          onSend={() => {}}
        />
      )}
    </View>
  );
}
