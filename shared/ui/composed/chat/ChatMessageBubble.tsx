import React from 'react';
import { View } from 'react-native';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import type { ChatBubbleMessage } from './types';

export interface ChatMessageBubbleProps {
  message: ChatBubbleMessage;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
  if (diffInHours < 24) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diffInHours < 48) return 'Yesterday';
  return date.toLocaleDateString();
}

/**
 * Single chat-message bubble shared across BitChat (geohash + DM) and White
 * Noise DMs. Lifted verbatim from `GeohashMessageBubble` in
 * `features/bitchat/screens/GeohashChatScreen.tsx` so the visual treatment
 * stays consistent. UserMessagesScreen has its own richer bubble
 * (Cashu-token redeem, streaming, reasoning) and is intentionally not
 * unified here — see audit 20-F-002 for the eventual full consolidation.
 */
export function ChatMessageBubble({
  message,
  isFirstInGroup,
  isLastInGroup,
}: ChatMessageBubbleProps) {
  const [foreground, defaultColor, surfaceTertiary, shade400] = useThemeColor([
    'foreground',
    'default',
    'surface-tertiary',
    'shade-400',
  ] as const);

  const showAvatar = !message.isOwn && isLastInGroup;
  const showName = !message.isOwn && isFirstInGroup;
  const showTimestamp = isLastInGroup;

  const marginBottom = isLastInGroup ? 16 : 2;

  const radius = 18;
  const tightRadius = 4;
  let borderTopLeftRadius = radius;
  let borderBottomLeftRadius = radius;
  let borderTopRightRadius = radius;
  let borderBottomRightRadius = radius;
  if (message.isOwn) {
    borderTopRightRadius = isFirstInGroup ? radius : tightRadius;
    borderBottomRightRadius = isLastInGroup ? radius : tightRadius;
  } else {
    borderTopLeftRadius = isFirstInGroup ? radius : tightRadius;
    borderBottomLeftRadius = isLastInGroup ? radius : tightRadius;
  }

  return (
    <VStack
      align={message.isOwn ? 'flex-end' : 'flex-start'}
      spacing={0}
      style={{
        marginBottom,
        maxWidth: '85%',
        alignSelf: message.isOwn ? 'flex-end' : 'flex-start',
      }}>
      <HStack
        align="flex-end"
        justify={message.isOwn ? 'flex-end' : 'flex-start'}
        spacing={8}
        style={{ width: '100%' }}>
        {!message.isOwn && (
          showAvatar ? (
            <Avatar
              state="fallback"
              size={32}
              seed={message.senderPubkey}
              name={message.sender ?? message.senderPubkey}
            />
          ) : (
            <View style={{ width: 32 }} />
          )
        )}

        <VStack
          align={message.isOwn ? 'flex-end' : 'flex-start'}
          spacing={2}
          style={{ flex: 1, maxWidth: '85%' }}>
          {showName && message.sender ? (
            <Text size={12} bold style={{ color: shade400, marginBottom: 2 }}>
              {message.sender}
            </Text>
          ) : null}

          <View
            style={{
              backgroundColor: message.isOwn ? defaultColor : surfaceTertiary,
              borderTopLeftRadius,
              borderBottomLeftRadius,
              borderTopRightRadius,
              borderBottomRightRadius,
              paddingHorizontal: 14,
              paddingVertical: 10,
              alignSelf: message.isOwn ? 'flex-end' : 'flex-start',
              opacity: message.isPending ? 0.6 : 1,
            }}>
            <Text
              size={16}
              style={{
                color: message.isOwn ? '#FFFFFF' : foreground,
                lineHeight: 22,
              }}>
              {message.content}
            </Text>
          </View>

          {showTimestamp ? (
            <Text
              size={11}
              style={{
                color: shade400,
                alignSelf: message.isOwn ? 'flex-end' : 'flex-start',
                marginTop: 2,
              }}>
              {message.isPending ? 'sending…' : formatTimestamp(message.timestamp)}
            </Text>
          ) : null}
        </VStack>
      </HStack>
    </VStack>
  );
}
