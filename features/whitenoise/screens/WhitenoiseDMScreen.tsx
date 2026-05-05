import React, { useCallback, useState } from 'react';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { router } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import { LegendList } from '@legendapp/list';
import { wnLog, Log, useLifecycleLogger } from '@/shared/lib/logger';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { resolveIdentityName } from '@/shared/lib/identity';
import {
  ChatComposer,
  ChatMessageBubble,
  DmChatHeader,
  useChatSurfacePerfLogger,
  useMessageGrouping,
  type ChatBubbleMessage,
} from '@/shared/ui/composed/chat';
import { useWhitenoiseDM, type WhitenoiseDmMessage } from '../hooks/useWhitenoiseDM';
import { MarmotIcon } from '../components/MarmotIcon';

/**
 * Visually identical to UserMessagesScreen DM mode and GeohashChatScreen DM
 * mode — all three mount the shared `<DmChatHeader>` (avatar + name + npub +
 * QR), `<ChatMessageBubble>` and `<ChatComposer>`. The transport identity
 * leaks only through the composer's leading icon (Marmot chipmunk) and the
 * group-creation pending state.
 */
export function WhitenoiseDMScreen({ pubkey }: { pubkey: string }) {
  useLifecycleLogger('WhitenoiseDMScreen');
  const headerHeight = useHeaderHeight();

  const { metadata } = useNostrProfileMetadata(pubkey);
  const { isLoading, isCreatingGroup, error, hasGroup, messages, send, isClientReady } =
    useWhitenoiseDM(pubkey);

  const [surface, shade400, shade500, danger] = useThemeColor([
    'surface',
    'shade-400',
    'shade-500',
    'danger',
  ] as const);

  const [draft, setDraft] = useState('');

  const onSubmit = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    const sendStart = performance.now();
    wnLog.info('chat.send.dispatch', {
      surface: 'whitenoise',
      textLen: text.length,
      historyCount: messages.length,
    });
    try {
      await send(text);
      wnLog.info('chat.send.complete', {
        surface: 'whitenoise',
        duration_ms: Math.round((performance.now() - sendStart) * 100) / 100,
      });
    } catch (err) {
      wnLog.warn('chat.send.failed', {
        surface: 'whitenoise',
        duration_ms: Math.round((performance.now() - sendStart) * 100) / 100,
        err,
      });
      throw err;
    }
  }, [draft, send, messages.length]);

  const peerName = resolveIdentityName({ pubkey, nostrProfile: metadata });
  const bubbleMessages: ChatBubbleMessage[] = messages.map(toBubble);
  const groupingMap = useMessageGrouping(bubbleMessages);

  const renderMessage = useCallback(
    ({ item }: { item: ChatBubbleMessage }) => {
      const group = groupingMap.get(item.id);
      return (
        <ChatMessageBubble
          message={item}
          isFirstInGroup={group?.isFirst ?? true}
          isLastInGroup={group?.isLast ?? true}
        />
      );
    },
    [groupingMap]
  );

  const perfSurface = 'whitenoise';
  const { handleListLayout, handleListContentSize, handleListScroll } = useChatSurfacePerfLogger({
    log: wnLog,
    surface: perfSurface,
    headerHeight,
    messages: bubbleMessages,
    historyExtras: (last) => ({
      lastIsOwn: last?.isOwn ?? null,
      lastIsPending: last?.isPending ?? null,
    }),
  });

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
      style={{ flex: 1 }}>
      <Log name="WhitenoiseDMScreen">
        <DmChatHeader pubkey={pubkey} onBack={() => router.back()} />

        <View style={{ flex: 1, backgroundColor: surface }}>
          {error ? (
            <Text size={13} style={{ color: danger, padding: 12 }}>
              {error}
            </Text>
          ) : null}

          <LegendList
            data={bubbleMessages}
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
              bubbleMessages.length === 0
                ? {
                    flexGrow: 1,
                    justifyContent: 'center',
                    alignItems: 'center',
                    padding: 16,
                  }
                : { padding: 16, paddingBottom: 16 }
            }
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListEmptyComponent={
              <VStack align="center" spacing={12}>
                <MarmotIcon size={48} />
                <Text size={16} style={{ color: shade400, textAlign: 'center' }}>
                  {!isClientReady
                    ? 'White Noise is not available yet.'
                    : isLoading
                      ? 'Loading…'
                      : !hasGroup
                        ? `Start an MLS-encrypted chat with ${peerName}.`
                        : `No messages yet. Say hi to ${peerName}!`}
                </Text>
                <Text size={13} style={{ color: shade500, textAlign: 'center' }}>
                  End-to-end encrypted via the Marmot Protocol (MLS).
                </Text>
              </VStack>
            }
          />

          <ChatComposer
            value={draft}
            onChangeText={setDraft}
            onSend={onSubmit}
            disabled={!isClientReady || isCreatingGroup}
            placeholder={isCreatingGroup ? 'Creating encrypted group…' : 'Encrypted message'}
            leadingIconNode={<MarmotIcon size={20} />}
            testID="whitenoise-dm-input"
            surface={perfSurface}
          />
        </View>
      </Log>
    </KeyboardAvoidingView>
  );
}

function toBubble(m: WhitenoiseDmMessage): ChatBubbleMessage {
  return {
    id: m.id,
    content: m.content,
    senderId: m.authorPubkey,
    timestamp: m.createdAt * 1000,
    isOwn: m.isSelf,
    isPending: m.isPending,
  };
}
