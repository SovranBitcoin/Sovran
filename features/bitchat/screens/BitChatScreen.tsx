import React, { useCallback, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  type KeyboardEvent,
} from 'react-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { chatLog } from '@/shared/lib/logger';
import { useBitChat } from '../hooks/useBitChat';
import { MessageList } from '../components/MessageList';
import { ComposeBar } from '../components/ComposeBar';
import { ChannelHeader } from '../components/ChannelHeader';

interface BitChatScreenProps {
  geohash: string;
  tierLabel?: string;
}

export function BitChatScreen({ geohash, tierLabel }: BitChatScreenProps) {
  const [background] = useThemeColor(['background'] as const);
  const { messages, isConnected, sendMessage } = useBitChat(geohash);

  // BitChatScreen still uses RN's stock `KeyboardAvoidingView` (not the
  // keyboard-controller variant), so we wire up the legacy Keyboard event
  // listeners directly. Logs the same `chat.kav.keyboard_state` shape as
  // the other surfaces so log-doctor's `--event chat.kav` filter is
  // homogeneous regardless of which KAV implementation owns the screen.
  const surface = 'bitchat-mesh';
  const kbRef = useRef({ isVisible: false, height: 0 });
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: KeyboardEvent) => {
      const next = { isVisible: true, height: e.endCoordinates.height };
      const prev = kbRef.current;
      chatLog.info('chat.kav.keyboard_state', {
        surface,
        from: { isVisible: prev.isVisible, height: prev.height },
        to: next,
        kavBehavior: Platform.OS === 'ios' ? 'padding' : 'undefined',
        kavOffset: 100,
      });
      kbRef.current = next;
    };
    const onHide = () => {
      const next = { isVisible: false, height: 0 };
      const prev = kbRef.current;
      chatLog.info('chat.kav.keyboard_state', {
        surface,
        from: { isVisible: prev.isVisible, height: prev.height },
        to: next,
        kavBehavior: Platform.OS === 'ios' ? 'padding' : 'undefined',
        kavOffset: 100,
      });
      kbRef.current = next;
    };
    const showSub = Keyboard.addListener(showEvt, onShow);
    const hideSub = Keyboard.addListener(hideEvt, onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const prevMsgRef = useRef({ count: 0, lastId: '' });
  useEffect(() => {
    const prev = prevMsgRef.current;
    const last = messages[messages.length - 1];
    const next = { count: messages.length, lastId: last?.id ?? '' };
    if (next.count === prev.count && next.lastId === prev.lastId) return;
    chatLog.info('chat.list.history_change', {
      surface,
      prevCount: prev.count,
      count: next.count,
      delta: next.count - prev.count,
    });
    prevMsgRef.current = next;
  }, [messages]);

  const handleSend = useCallback(
    (content: string) => {
      const sendStart = performance.now();
      chatLog.info('chat.send.dispatch', {
        surface,
        textLen: content.length,
        historyCount: messages.length,
        kbVisible: kbRef.current.isVisible,
      });
      try {
        sendMessage(content);
        chatLog.info('chat.send.complete', {
          surface,
          duration_ms: Math.round((performance.now() - sendStart) * 100) / 100,
        });
      } catch (err) {
        chatLog.warn('chat.send.failed', {
          surface,
          duration_ms: Math.round((performance.now() - sendStart) * 100) / 100,
          err,
        });
        throw err;
      }
    },
    [sendMessage, messages.length]
  );

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}>
      <ChannelHeader
        geohash={geohash}
        tierLabel={tierLabel}
        isConnected={isConnected}
        messageCount={messages.length}
      />
      <View style={styles.messages}>
        <MessageList messages={messages} />
      </View>
      <ComposeBar onSend={handleSend} disabled={!isConnected} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  messages: {
    flex: 1,
  },
});
