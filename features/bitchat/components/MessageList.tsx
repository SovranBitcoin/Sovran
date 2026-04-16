import React, { useRef, useEffect } from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from 'bitchat-module';

interface MessageListProps {
  messages: ChatMessage[];
}

export const MessageList = React.memo(function MessageList({ messages }: MessageListProps) {
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (messages.length > 0) {
      // Scroll to bottom on new messages
      setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  return (
    <FlatList
      ref={listRef}
      data={messages}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <MessageBubble message={item} />}
      contentContainerStyle={styles.content}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    />
  );
});

const styles = StyleSheet.create({
  content: {
    paddingVertical: 12,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
});
