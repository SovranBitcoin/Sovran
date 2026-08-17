import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { formatRelative } from '@/shared/lib/date';
import { chatLog } from '@/shared/lib/logger';
import { CashuTokenBubble } from './CashuTokenBubble';
import type { ChatBubbleMessage } from './types';

interface ChatMessageBubbleProps {
  message: ChatBubbleMessage;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  counterpartyAvatar?: React.ReactNode | null;
  /**
   * When `message.deliveryStatus === 'failed'`, the bubble renders a small
   * tap target below it inviting the user to retry. Wire this from the
   * screen to re-dispatch the message's content (typically generates a fresh
   * messageID and triggers a new handshake). The original failed bubble
   * remains as a record of the attempt.
   */
  onRetry?: () => void;
}

export function ChatMessageBubble({
  message,
  isFirstInGroup,
  isLastInGroup,
  counterpartyAvatar,
  onRetry,
}: ChatMessageBubbleProps) {
  const [foreground, defaultColor, surfaceTertiary, shade400, shade500, danger] = useThemeColor([
    'foreground',
    'default',
    'surface-tertiary',
    'shade-400',
    'shade-500',
    'danger',
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

  useEffect(() => {
    chatLog.debug('chat.message_bubble.render', {
      idLength: message.id.length,
      isOwn: message.isOwn,
      isFirstInGroup,
      isLastInGroup,
      senderIdLength: message.senderId.length,
      senderNameLength: message.sender?.length ?? 0,
      contentLength: message.content.length,
      displayContentLength: displayContent.length,
      hasCashuToken: !!cashuToken,
      cashuTokenLength: cashuToken?.length ?? 0,
      hasText,
      deliveryStatus: message.deliveryStatus ?? null,
      showAvatar,
      showName,
      showTimestamp,
      hasCounterpartyAvatarOverride: counterpartyAvatar !== undefined,
      canRetry: !!onRetry && message.deliveryStatus === 'failed',
    });
  }, [
    cashuToken,
    counterpartyAvatar,
    displayContent.length,
    hasText,
    isFirstInGroup,
    isLastInGroup,
    message,
    onRetry,
    showAvatar,
    showName,
    showTimestamp,
  ]);

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
                message.deliveryStatus === 'sending' ? (
                  <Spinner size={12} color={shade500} />
                ) : (
                  <Icon
                    name={
                      message.deliveryStatus === 'failed'
                        ? 'mdi:alert-circle-outline'
                        : message.deliveryStatus === 'delivered'
                          ? 'mdi:check-all'
                          : 'simple-line-icons:check'
                    }
                    size={12}
                    color={message.deliveryStatus === 'failed' ? danger : shade500}
                  />
                )
              ) : null}
            </HStack>
          ) : null}
          {message.isOwn && message.deliveryStatus === 'failed' && onRetry ? (
            <Pressable
              onPress={() => {
                chatLog.info('chat.message_bubble.retry_press', {
                  idLength: message.id.length,
                  contentLength: message.content.length,
                  hasCashuToken: !!cashuToken,
                  cashuTokenLength: cashuToken?.length ?? 0,
                });
                onRetry();
              }}
              hitSlop={8}
              style={{ alignSelf: 'flex-end', marginTop: 2 }}>
              <Text size={11} style={{ color: danger, fontWeight: '600' }}>
                Tap to retry
              </Text>
            </Pressable>
          ) : null}
        </VStack>
      </HStack>
    </VStack>
  );
}
