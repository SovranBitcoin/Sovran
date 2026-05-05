/**
 * @fileoverview Geohash-based location chat screen
 *
 * Visually matches UserMessagesScreen but powered by BitChat's
 * geohash Nostr protocol (kind 20000 ephemeral events with #g tag).
 * Reuses the same UI primitives for a consistent look.
 */

import React, { useState, useRef, useCallback } from 'react';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { router, Stack } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import { LegendList } from '@legendapp/list';

import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import Icon from 'assets/icons';

import { Hex64 } from '@sovranbitcoin/schemas';

import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { CONNECTED_ACCENT } from '@/shared/lib/brandColors';
import { Log, useLifecycleLogger, bitchatLog } from '@/shared/lib/logger';
import { useBitChat } from '../hooks/useBitChat';
import { useBLEPeers } from '../hooks/useBLEPeers';
import {
  ChatComposer,
  ChatMessageBubble,
  DmChatHeader,
  useChatSurfacePerfLogger,
  useMessageGrouping,
} from '@/shared/ui/composed/chat';
import type { ChatMessage } from 'bitchat-module';

// ===========================
// MAIN COMPONENT
// ===========================

interface GeohashChatScreenProps {
  /**
   * Geohash channel identifier. Required for `'nostr'` (public) and
   * `'nostr-dm'` transports — the hook short-circuits when missing.
   * Optional for `'ble'` / `'ble-dm'` transports, which ignore it.
   */
  geohash?: string;
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

  // Surface tag groups everything in log-doctor so a single `--event chat`
  // filter spans every chat surface, while `transport` differentiates
  // public mesh vs DM in the same screen. Named `perfSurface` because the
  // theme destructure above already binds `surface` (the color token).
  const perfSurface = `bitchat-${transport}`;
  const { handleListLayout, handleListContentSize, handleListScroll } = useChatSurfacePerfLogger({
    log: bitchatLog,
    surface: perfSurface,
    headerHeight,
    messages,
  });

  // Precompute grouping: consecutive messages from the same sender form a group
  const groupingMap = useMessageGrouping(messages);

  const renderMessage = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const group = groupingMap.get(item.id);
      return (
        <ChatMessageBubble
          message={{
            id: item.id,
            content: item.content,
            senderId: item.senderId,
            sender: item.sender,
            timestamp: item.timestamp,
            isOwn: item.isOwn,
          }}
          isFirstInGroup={group?.isFirst ?? true}
          isLastInGroup={group?.isLast ?? true}
        />
      );
    },
    [groupingMap]
  );

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
        error: err instanceof Error ? err.message : String(err),
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
  const isNostrPubkey = !!dmPeerID && Hex64.safeParse(dmPeerID).success;

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
      style={{ flex: 1 }}>
      <Log name="GeohashChatScreen">
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
                        color={bleConnectedCount > 0 ? CONNECTED_ACCENT : shade400}
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
                        backgroundColor: isConnected ? CONNECTED_ACCENT : shade400,
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
            renderItem={renderMessage}
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
      </Log>
    </KeyboardAvoidingView>
  );
}
