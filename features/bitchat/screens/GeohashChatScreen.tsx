/**
 * @fileoverview Geohash-based location chat screen
 *
 * Visually matches UserMessagesScreen but powered by BitChat's
 * geohash Nostr protocol (kind 20000 ephemeral events with #g tag).
 * Reuses the same UI primitives for a consistent look.
 */

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  Pressable,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { KeyboardAvoidingView, useKeyboardState } from 'react-native-keyboard-controller';
import { router, Stack } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import { LegendList } from '@legendapp/list';

import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import Icon from 'assets/icons';

import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Screen, useLifecycleLogger, log } from '@/shared/lib/logger';
import { useBitChat } from '../hooks/useBitChat';
import { useBLEPeers } from '../hooks/useBLEPeers';
import {
  ChatComposer,
  ChatMessageBubble,
  DmChatHeader,
  useMessageGrouping,
} from '@/shared/ui/composed/chat';

const bitchatLog = log.child({ module: 'bitchat' });
import type { ChatMessage } from 'bitchat-module';
import { LOCATION_TIERS } from '../lib/constants';

// ===========================
// MAIN COMPONENT
// ===========================

export interface GeohashChatScreenProps {
  geohash: string;
  tierLabel?: string;
  /**
   * Transport mode:
   *  - `'nostr'` / `'ble'` — public geohash / BLE mesh chat (default).
   *  - `'nostr-dm'` / `'ble-dm'` — 1:1 private chat. Requires `dmPeerID`.
   *    For `'nostr-dm'` the peerID is the per-geohash Nostr pubkey; for
   *    `'ble-dm'` it's the 16-hex bitchat PeerID.
   */
  transport?: 'nostr' | 'ble' | 'nostr-dm' | 'ble-dm';
  /** Target peer for DM transports. Ignored in public mode. */
  dmPeerID?: string;
  /** Display name for the DM peer. Used in the header title. */
  dmNickname?: string;
  onBack?: () => void;
}

export function GeohashChatScreen({
  geohash,
  tierLabel,
  transport = 'nostr',
  dmPeerID,
  dmNickname,
  onBack,
}: GeohashChatScreenProps) {
  useLifecycleLogger('GeohashChatScreen');
  const headerHeight = useHeaderHeight();
  const listRef = useRef<any>(null);

  const [foreground, surfaceSecondary, surface, shade400, shade500] = useThemeColor([
    'foreground',
    'surface-secondary',
    'surface',
    'shade-400',
    'shade-500',
  ] as const);

  const [messageText, setMessageText] = useState('');
  const [isSending, setIsSending] = useState(false);

  const { messages, isConnected, sendMessage } = useBitChat(
    geohash,
    transport,
    dmPeerID ? { dm: { peerID: dmPeerID, nickname: dmNickname } } : undefined
  );
  // Always call; the hook is safe when BLE isn't running (getBLEPeers returns
  // empty, event listener no-ops). We only render the peer count on the mesh
  // tier below.
  const { peers: blePeers, connectedCount: bleConnectedCount } = useBLEPeers();

  React.useEffect(() => {
    bitchatLog.debug('bitchat.screen.messages', {
      count: messages.length,
      isConnected,
      geohash,
      transport,
    });
  }, [messages.length, isConnected, geohash, transport]);

  // ─── Perf instrumentation: KAV / list / message count ──────────────────
  // Surface tag groups everything in log-doctor so a single `--event chat`
  // filter spans every chat surface, while `transport` differentiates
  // public mesh vs DM in the same screen. Renamed from `surface` to
  // `perfSurface` because the theme destructure on line 79 already binds
  // `surface` (the surface color token).
  const perfSurface = `bitchat-${transport}`;
  const kbState = useKeyboardState();
  const kbStateRef = useRef({ isVisible: false, height: 0 });
  useEffect(() => {
    const prev = kbStateRef.current;
    if (prev.isVisible === kbState.isVisible && prev.height === kbState.height) return;
    bitchatLog.info('chat.kav.keyboard_state', {
      surface: perfSurface,
      from: { isVisible: prev.isVisible, height: prev.height },
      to: { isVisible: kbState.isVisible, height: kbState.height },
      headerHeight,
    });
    kbStateRef.current = { isVisible: kbState.isVisible, height: kbState.height };
  }, [kbState.isVisible, kbState.height, headerHeight, perfSurface]);

  const listLayoutRef = useRef<{ height: number; width: number } | null>(null);
  // Typed loosely on purpose — `@legendapp/list`'s onLayout/onScroll prop
  // types ship a re-export of RN's event types that doesn't unify with the
  // one from `react-native` direct, so the precise types fight us.
  const handleListLayout = useCallback(
    (e: LayoutChangeEvent | any) => {
      const { width, height } = (e as LayoutChangeEvent).nativeEvent.layout;
      const last = listLayoutRef.current;
      if (last && Math.abs(last.width - width) < 0.5 && Math.abs(last.height - height) < 0.5) {
        return;
      }
      listLayoutRef.current = { width, height };
      bitchatLog.info('chat.list.layout', {
        surface: perfSurface,
        width: Math.round(width),
        height: Math.round(height),
      });
    },
    [perfSurface]
  );

  const listContentSizeRef = useRef<{ w: number; h: number } | null>(null);
  const handleListContentSize = useCallback(
    (w: number, h: number) => {
      const last = listContentSizeRef.current;
      if (last && Math.abs(last.w - w) < 0.5 && Math.abs(last.h - h) < 0.5) return;
      const viewportH = listLayoutRef.current?.height ?? 0;
      listContentSizeRef.current = { w, h };
      bitchatLog.debug('chat.list.content_size', {
        surface: perfSurface,
        contentW: Math.round(w),
        contentH: Math.round(h),
        viewportH: Math.round(viewportH),
        overflow: Math.round(h - viewportH),
        msgsCount: messages.length,
      });
    },
    [perfSurface, messages.length]
  );

  const lastScrollLogRef = useRef(0);
  const handleListScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent> | any) => {
      const now = Date.now();
      if (now - lastScrollLogRef.current < 120) return;
      lastScrollLogRef.current = now;
      const { contentOffset, contentSize, layoutMeasurement } = (
        e as NativeSyntheticEvent<NativeScrollEvent>
      ).nativeEvent;
      const distFromEnd = contentSize.height - (contentOffset.y + layoutMeasurement.height);
      bitchatLog.debug('chat.list.scroll', {
        surface: perfSurface,
        offsetY: Math.round(contentOffset.y),
        contentH: Math.round(contentSize.height),
        viewportH: Math.round(layoutMeasurement.height),
        distFromEnd: Math.round(distFromEnd),
      });
    },
    [perfSurface]
  );

  const prevMsgRef = useRef({ count: 0, lastId: '' });
  useEffect(() => {
    const prev = prevMsgRef.current;
    const last = messages[messages.length - 1];
    const next = { count: messages.length, lastId: last?.id ?? '' };
    if (next.count === prev.count && next.lastId === prev.lastId) return;
    bitchatLog.info('chat.list.history_change', {
      surface: perfSurface,
      prevCount: prev.count,
      count: next.count,
      delta: next.count - prev.count,
    });
    prevMsgRef.current = next;
  }, [messages, perfSurface]);

  const tierDef = useMemo(() => LOCATION_TIERS.find((t) => t.label === tierLabel), [tierLabel]);

  // Precompute grouping: consecutive messages from the same sender form a group
  const groupingMap = useMessageGrouping(messages);

  const handleSendMessageInner = useCallback(async () => {
    const text = messageText.trim();
    if (!text || isSending) return;

    setIsSending(true);
    setMessageText('');
    const sendStart = performance.now();
    bitchatLog.info('chat.send.dispatch', {
      surface: `bitchat-${transport}`,
      textLen: text.length,
      historyCount: messages.length,
    });
    try {
      await sendMessage(text);
      bitchatLog.info('chat.send.complete', {
        surface: `bitchat-${transport}`,
        duration_ms: Math.round((performance.now() - sendStart) * 100) / 100,
      });
    } catch (err) {
      bitchatLog.warn('chat.send.failed', {
        surface: `bitchat-${transport}`,
        duration_ms: Math.round((performance.now() - sendStart) * 100) / 100,
        err,
      });
      throw err;
    } finally {
      setIsSending(false);
    }
  }, [messageText, isSending, sendMessage, transport, messages.length]);

  // `isSending` flips via React state — a rapid double-tap on the composer
  // bypasses the guard before the flag commits, broadcasting two BLE-mesh
  // packets (or two nostr-DM events). Single-flight closes the window.
  const handleSendMessage = useSingleFlight(handleSendMessageInner);

  const handleBack = useCallback(() => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  }, [onBack]);

  // DM transports show the peer name; public transports show the tier.
  const isDM = transport === 'ble-dm' || transport === 'nostr-dm';
  const title = isDM
    ? dmNickname || (dmPeerID ? dmPeerID.slice(0, 12) : 'Direct message')
    : tierLabel
      ? `${tierLabel} Chat`
      : `#${geohash}`;

  // For nostr-dm the dmPeerID is a 64-hex Nostr pubkey (per-geohash ephemeral
  // identity). For ble-dm it's a 16-hex BitChat peer ID — no Nostr identity,
  // so DmChatHeader falls back to nickname-only and hides the npub/QR.
  const isNostrPubkey = !!dmPeerID && /^[0-9a-f]{64}$/.test(dmPeerID);

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
      style={{ flex: 1 }}>
      <Screen name="GeohashChatScreen">
        {isDM ? (
          <DmChatHeader
            pubkey={isNostrPubkey ? dmPeerID : undefined}
            nickname={dmNickname}
            displayName={dmNickname || (dmPeerID ? dmPeerID.slice(0, 12) : undefined)}
            onBack={handleBack}
          />
        ) : (
          <Stack.Screen
            options={{
              headerShown: true,
              headerTransparent: false,
              headerStyle: { backgroundColor: surfaceSecondary },
              headerShadowVisible: false,
              headerBackVisible: false,
              headerTintColor: foreground,
              title,
              headerLeft: () => (
                <Pressable onPress={handleBack} hitSlop={8}>
                  <Icon name="material-symbols:arrow-back-rounded" size={24} color={foreground} />
                </Pressable>
              ),
              headerRight: () =>
                transport === 'ble' ? (
                  // Tappable peer-count pill for the mesh chat. Mirrors
                  // upstream bitchat's header icon+count affordance that
                  // opens the Network sheet.
                  <Pressable onPress={() => router.push('/(user-flow)/bitchatNetwork')} hitSlop={8}>
                    <HStack spacing={6} align="center">
                      <Icon
                        name="mdi:broadcast"
                        size={16}
                        color={bleConnectedCount > 0 ? '#34C759' : shade400}
                      />
                      <Text
                        size={13}
                        style={{
                          color: bleConnectedCount > 0 ? foreground : shade400,
                          fontWeight: '600',
                        }}>
                        {blePeers.length}
                      </Text>
                      <Text size={13} style={{ color: shade400 }}>
                        #mesh
                      </Text>
                    </HStack>
                  </Pressable>
                ) : (
                  <HStack spacing={8} align="center">
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: isConnected ? '#34C759' : shade400,
                      }}
                    />
                    <Text size={13} style={{ color: shade400 }}>
                      #{geohash}
                    </Text>
                  </HStack>
                ),
            }}
          />
        )}

        <View style={{ flex: 1, backgroundColor: surface }}>
          {/* Messages */}
          <LegendList
            ref={listRef}
            data={messages}
            onLayout={handleListLayout}
            onContentSizeChange={handleListContentSize}
            onScroll={handleListScroll}
            scrollEventThrottle={120}
            renderItem={({ item }: { item: ChatMessage }) => {
              const group = groupingMap.get(item.id);
              return (
                <ChatMessageBubble
                  message={{
                    id: item.id,
                    content: item.content,
                    senderPubkey: item.senderPubkey,
                    sender: item.sender,
                    timestamp: item.timestamp,
                    isOwn: item.isOwn,
                  }}
                  isFirstInGroup={group?.isFirst ?? true}
                  isLastInGroup={group?.isLast ?? true}
                />
              );
            }}
            keyExtractor={(item: ChatMessage) => item.id}
            initialScrollAtEnd
            maintainScrollAtEnd
            maintainScrollAtEndThreshold={0.2}
            alignItemsAtEnd
            estimatedItemSize={80}
            recycleItems={false}
            style={{ flex: 1 }}
            contentContainerStyle={
              messages.length === 0
                ? {
                    flexGrow: 1,
                    justifyContent: 'center',
                    alignItems: 'center',
                    padding: 16,
                  }
                : {
                    padding: 16,
                    paddingBottom: 16,
                  }
            }
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListEmptyComponent={
              <VStack align="center" spacing={12}>
                <Icon
                  name={isDM ? 'mdi:account-group' : 'mdi:map-marker-radius'}
                  size={32}
                  color={shade400}
                />
                <Text size={16} style={{ color: shade400, textAlign: 'center' }}>
                  {isConnected
                    ? isDM
                      ? `No messages yet. Say hi to ${title}!`
                      : 'No messages yet. Start the conversation!'
                    : transport === 'ble' || transport === 'ble-dm'
                      ? 'Scanning for nearby devices...'
                      : 'Connecting to relays...'}
                </Text>
                <Text size={13} style={{ color: shade500, textAlign: 'center' }}>
                  {transport === 'ble-dm'
                    ? 'Private chat over encrypted Bluetooth mesh'
                    : transport === 'nostr-dm'
                      ? 'Private chat over Nostr gift-wrap (NIP-17)'
                      : transport === 'ble'
                        ? 'Chat with people nearby via Bluetooth mesh'
                        : tierLabel
                          ? `Chat with people in your ${tierLabel.toLowerCase()}`
                          : `Geohash channel #${geohash}`}
                </Text>
              </VStack>
            }
          />

          <ChatComposer
            value={messageText}
            onChangeText={setMessageText}
            onSend={handleSendMessage}
            disabled={isSending}
            leadingIcon="mdi:map-marker"
            surface={perfSurface}
          />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
