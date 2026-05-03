import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { KeyboardAvoidingView, useKeyboardState } from 'react-native-keyboard-controller';
import { router } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import { LegendList } from '@legendapp/list';
import { wnLog, Screen, useLifecycleLogger } from '@/shared/lib/logger';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { resolveIdentityName } from '@/shared/lib/identity';
import {
  ChatComposer,
  ChatMessageBubble,
  DmChatHeader,
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
  const accountIndex = useProfileStore((s) => s.activeAccountIndex);
  const headerHeight = useHeaderHeight();

  const { metadata } = useNostrProfileMetadata(pubkey);
  const { isLoading, isCreatingGroup, error, hasGroup, messages, send, isClientReady } =
    useWhitenoiseDM(pubkey, accountIndex);

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

  // ─── Perf instrumentation ──────────────────────────────────────────────
  const perfSurface = 'whitenoise';
  const kbState = useKeyboardState();
  const kbStateRef = useRef({ isVisible: false, height: 0 });
  useEffect(() => {
    const prev = kbStateRef.current;
    if (prev.isVisible === kbState.isVisible && prev.height === kbState.height) return;
    wnLog.info('chat.kav.keyboard_state', {
      surface: perfSurface,
      from: { isVisible: prev.isVisible, height: prev.height },
      to: { isVisible: kbState.isVisible, height: kbState.height },
      headerHeight,
    });
    kbStateRef.current = { isVisible: kbState.isVisible, height: kbState.height };
  }, [kbState.isVisible, kbState.height, headerHeight]);

  const listLayoutRef = useRef<{ height: number; width: number } | null>(null);
  // Typed loosely on purpose — `@legendapp/list`'s `onLayout` ships a
  // re-export of RN's LayoutChangeEvent that doesn't unify with the one
  // from `react-native` directly. Same story for `onScroll`.
  const handleListLayout = useCallback((e: LayoutChangeEvent | any) => {
    const { width, height } = (e as LayoutChangeEvent).nativeEvent.layout;
    const last = listLayoutRef.current;
    if (last && Math.abs(last.width - width) < 0.5 && Math.abs(last.height - height) < 0.5) {
      return;
    }
    listLayoutRef.current = { width, height };
    wnLog.info('chat.list.layout', {
      surface: perfSurface,
      width: Math.round(width),
      height: Math.round(height),
    });
  }, []);

  const listContentSizeRef = useRef<{ w: number; h: number } | null>(null);
  const handleListContentSize = useCallback(
    (w: number, h: number) => {
      const last = listContentSizeRef.current;
      if (last && Math.abs(last.w - w) < 0.5 && Math.abs(last.h - h) < 0.5) return;
      const viewportH = listLayoutRef.current?.height ?? 0;
      listContentSizeRef.current = { w, h };
      wnLog.debug('chat.list.content_size', {
        surface: perfSurface,
        contentW: Math.round(w),
        contentH: Math.round(h),
        viewportH: Math.round(viewportH),
        overflow: Math.round(h - viewportH),
        msgsCount: bubbleMessages.length,
      });
    },
    [bubbleMessages.length]
  );

  const lastScrollLogRef = useRef(0);
  const handleListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent> | any) => {
    const now = Date.now();
    if (now - lastScrollLogRef.current < 120) return;
    lastScrollLogRef.current = now;
    const { contentOffset, contentSize, layoutMeasurement } = (
      e as NativeSyntheticEvent<NativeScrollEvent>
    ).nativeEvent;
    const distFromEnd = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    wnLog.debug('chat.list.scroll', {
      surface: perfSurface,
      offsetY: Math.round(contentOffset.y),
      contentH: Math.round(contentSize.height),
      viewportH: Math.round(layoutMeasurement.height),
      distFromEnd: Math.round(distFromEnd),
    });
  }, []);

  const prevMsgRef = useRef({ count: 0, lastId: '' });
  useEffect(() => {
    const prev = prevMsgRef.current;
    const last = bubbleMessages[bubbleMessages.length - 1];
    const next = { count: bubbleMessages.length, lastId: last?.id ?? '' };
    if (next.count === prev.count && next.lastId === prev.lastId) return;
    wnLog.info('chat.list.history_change', {
      surface: perfSurface,
      prevCount: prev.count,
      count: next.count,
      delta: next.count - prev.count,
      lastIsOwn: last?.isOwn ?? null,
      lastIsPending: last?.isPending ?? null,
    });
    prevMsgRef.current = next;
  }, [bubbleMessages]);

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
      style={{ flex: 1 }}>
      <Screen name="WhitenoiseDMScreen">
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
            renderItem={({ item }: { item: ChatBubbleMessage }) => {
              const group = groupingMap.get(item.id);
              return (
                <ChatMessageBubble
                  message={item}
                  isFirstInGroup={group?.isFirst ?? true}
                  isLastInGroup={group?.isLast ?? true}
                />
              );
            }}
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
      </Screen>
    </KeyboardAvoidingView>
  );
}

function toBubble(m: WhitenoiseDmMessage): ChatBubbleMessage {
  return {
    id: m.id,
    content: m.content,
    senderPubkey: m.authorPubkey,
    timestamp: m.createdAt * 1000,
    isOwn: m.isSelf,
    isPending: m.isPending,
  };
}
