import React, { useCallback } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
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

  const handleSend = useCallback(
    (content: string) => {
      sendMessage(content);
    },
    [sendMessage]
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
