import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';
import type { ChatMessage } from 'bitchat-module';

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble = React.memo(function MessageBubble({ message }: MessageBubbleProps) {
  const [foreground, surface, accent] = useThemeColor([
    'foreground',
    'surface',
    'accent',
  ] as const);

  const time = new Date(message.timestamp);
  const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;

  return (
    <View style={[styles.row, message.isOwn && styles.rowOwn]}>
      <View
        style={[
          styles.bubble,
          message.isOwn
            ? { backgroundColor: accent }
            : { backgroundColor: surface },
        ]}>
        {!message.isOwn && (
          <Text
            style={[
              styles.sender,
              { color: message.isOwn ? '#fff' : accent },
            ]}
            numberOfLines={1}>
            {message.sender}
          </Text>
        )}
        <Text
          style={[
            styles.content,
            { color: message.isOwn ? '#fff' : foreground },
          ]}>
          {message.content}
        </Text>
        <Text
          style={[
            styles.time,
            {
              color: message.isOwn
                ? 'rgba(255,255,255,0.6)'
                : opacity(foreground, 0.4),
            },
          ]}>
          {timeStr}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingVertical: 3,
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  rowOwn: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  sender: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  content: {
    fontSize: 16,
    lineHeight: 22,
  },
  time: {
    fontSize: 11,
    marginTop: 4,
    textAlign: 'right',
  },
});
