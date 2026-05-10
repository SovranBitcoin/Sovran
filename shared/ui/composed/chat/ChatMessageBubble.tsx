import React from 'react';
import { View } from 'react-native';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { formatRelative } from '@/shared/lib/date';
import { CashuTokenBubble } from './CashuTokenBubble';
import type { ChatBubbleMessage } from './types';

interface ChatMessageBubbleProps {
  message: ChatBubbleMessage;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  /**
   * Avatar override for non-own messages. When the surface has counterparty
   * profile metadata (kind:0 picture / display name) it can supply a richer
   * avatar than the default identicon-from-`senderId`. Pass `null` to hide
   * the avatar slot entirely (e.g. ephemeral group chats with no identity).
   */
  ownAvatar?: React.ReactNode;
  counterpartyAvatar?: React.ReactNode | null;
}

export function ChatMessageBubble({
  message,
  isFirstInGroup,
  isLastInGroup,
  ownAvatar,
  counterpartyAvatar,
}: ChatMessageBubbleProps) {
  const [foreground, defaultColor, surfaceTertiary, shade400, shade500] = useThemeColor([
    'foreground',
    'default',
    'surface-tertiary',
    'shade-400',
    'shade-500',
  ] as const);

  const showAvatar = !message.isOwn && isLastInGroup;
  const showName = !message.isOwn && isFirstInGroup;
  const showTimestamp = isLastInGroup;
  const isSending = message.deliveryStatus === 'sending';

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

  const cashuToken = message.cashuToken;
  const displayContent = cashuToken
    ? message.content.replace(cashuToken, '').trim()
    : message.content;
  const hasText = displayContent.length > 0;

  const counterpartyAvatarNode =
    counterpartyAvatar === null ? null : counterpartyAvatar !== undefined ? (
      counterpartyAvatar
    ) : (
      <Avatar
        state="fallback"
        size={32}
        seed={message.senderId}
        name={message.sender ?? message.senderId}
      />
    );

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
        {!message.isOwn && counterpartyAvatarNode !== null ? (
          showAvatar ? (
            counterpartyAvatarNode
          ) : (
            <View style={{ width: 32 }} />
          )
        ) : null}

        <VStack
          align={message.isOwn ? 'flex-end' : 'flex-start'}
          spacing={2}
          style={{ flex: 1, maxWidth: '85%' }}>
          {showName && message.sender ? (
            <Text size={12} bold style={{ color: shade400, marginBottom: 2 }}>
              {message.sender}
            </Text>
          ) : null}

          {hasText ? (
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
                opacity: isSending ? 0.6 : 1,
              }}>
              <Text
                size={16}
                style={{
                  color: message.isOwn ? '#FFFFFF' : foreground,
                  lineHeight: 22,
                }}>
                {displayContent}
              </Text>
            </View>
          ) : null}

          {cashuToken ? <CashuTokenBubble token={cashuToken} isOwn={message.isOwn} /> : null}

          {showTimestamp ? (
            <HStack
              align="center"
              spacing={4}
              style={{ alignSelf: message.isOwn ? 'flex-end' : 'flex-start', marginTop: 2 }}>
              <Text size={11} style={{ color: shade400 }}>
                {formatRelative(message.timestamp, 'chat-bubble')}
              </Text>
              {message.isOwn && message.deliveryStatus ? (
                <Icon
                  name={isSending ? 'ant-design:loading-outlined' : 'simple-line-icons:check'}
                  size={12}
                  color={shade500}
                />
              ) : null}
            </HStack>
          ) : null}
        </VStack>

        {message.isOwn && ownAvatar ? ownAvatar : null}
      </HStack>
    </VStack>
  );
}
