import React, { useCallback, useEffect, useRef } from 'react';
import {
  FlatList,
  StyleSheet,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from 'bitchat-module';
import { chatLog } from '@/shared/lib/logger';

interface MessageListProps {
  messages: ChatMessage[];
}

export const MessageList = React.memo(function MessageList({ messages }: MessageListProps) {
  const listRef = useRef<FlatList>(null);
  const surface = 'bitchat-mesh-flatlist';

  // The 100ms setTimeout below means new-message → scroll-to-end can lag a
  // full frame past the message append. Logged so we can correlate the
  // fired-but-late scroll with whatever the user perceives as "weird
  // animation when adding a message".
  useEffect(() => {
    if (messages.length > 0) {
      const start = performance.now();
      chatLog.debug('chat.list.scroll_to_end_scheduled', {
        surface,
        msgsCount: messages.length,
        delay_ms: 100,
      });
      const timer = setTimeout(() => {
        chatLog.debug('chat.list.scroll_to_end_fired', {
          surface,
          msgsCount: messages.length,
          delay_actual_ms: Math.round((performance.now() - start) * 100) / 100,
        });
        listRef.current?.scrollToEnd({ animated: true });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [messages.length]);

  const layoutRef = useRef<{ width: number; height: number } | null>(null);
  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const last = layoutRef.current;
    if (last && Math.abs(last.width - width) < 0.5 && Math.abs(last.height - height) < 0.5) {
      return;
    }
    layoutRef.current = { width, height };
    chatLog.info('chat.list.layout', {
      surface,
      width: Math.round(width),
      height: Math.round(height),
    });
  }, []);

  const contentSizeRef = useRef<{ w: number; h: number } | null>(null);
  const handleContentSize = useCallback(
    (w: number, h: number) => {
      const last = contentSizeRef.current;
      if (last && Math.abs(last.w - w) < 0.5 && Math.abs(last.h - h) < 0.5) return;
      const viewportH = layoutRef.current?.height ?? 0;
      contentSizeRef.current = { w, h };
      chatLog.debug('chat.list.content_size', {
        surface,
        contentW: Math.round(w),
        contentH: Math.round(h),
        viewportH: Math.round(viewportH),
        overflow: Math.round(h - viewportH),
        msgsCount: messages.length,
      });
    },
    [messages.length]
  );

  const lastScrollLogRef = useRef(0);
  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const now = Date.now();
    if (now - lastScrollLogRef.current < 120) return;
    lastScrollLogRef.current = now;
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    chatLog.debug('chat.list.scroll', {
      surface,
      offsetY: Math.round(contentOffset.y),
      contentH: Math.round(contentSize.height),
      viewportH: Math.round(layoutMeasurement.height),
      distFromEnd: Math.round(
        contentSize.height - (contentOffset.y + layoutMeasurement.height)
      ),
    });
  }, []);

  return (
    <FlatList
      ref={listRef}
      data={messages}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <MessageBubble message={item} />}
      contentContainerStyle={styles.content}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      onLayout={handleLayout}
      onContentSizeChange={handleContentSize}
      onScroll={handleScroll}
      scrollEventThrottle={120}
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
