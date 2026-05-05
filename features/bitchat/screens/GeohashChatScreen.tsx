/**
 * @fileoverview Geohash-based location chat screen
 *
 * Visually matches the other DM surfaces but powered by BitChat's
 * geohash Nostr protocol (kind 20000 ephemeral events with #g tag).
 * Public mode renders a custom header (peer-count pill / connection dot);
 * DM modes mount the shared `<DmChatHeader>`.
 */

import React, { useEffect, useMemo } from 'react';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { router, Stack } from 'expo-router';

import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import Icon from 'assets/icons';

import { Hex64 } from '@sovranbitcoin/schemas';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { CONNECTED_ACCENT } from '@/shared/lib/brandColors';
import { useLifecycleLogger, bitchatLog } from '@/shared/lib/logger';
import { useBitChat } from '../hooks/useBitChat';
import { useBLEPeers } from '../hooks/useBLEPeers';
import {
  ChatScreen,
  DmChatHeader,
  extractCashuToken,
  type ChatBubbleMessage,
} from '@/shared/ui/composed/chat';
import type { ChatMessage } from 'bitchat-module';

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

  const [foreground, surfaceSecondary, shade400, shade500] = useThemeColor([
    'foreground',
    'surface-secondary',
    'shade-400',
    'shade-500',
  ] as const);

  const { messages, isConnected, sendMessage } = useBitChat(
    geohash,
    transport,
    dmPeerID ? { dm: { peerID: dmPeerID, nickname: dmNickname } } : undefined
  );
  // Always call; the hook is safe when BLE isn't running. We only render
  // the peer count on the mesh tier below.
  const { peers: blePeers, connectedCount: bleConnectedCount } = useBLEPeers();

  useEffect(() => {
    bitchatLog.debug('bitchat.screen.messages', {
      count: messages.length,
      isConnected,
      geohash,
      transport,
    });
  }, [messages.length, isConnected, geohash, transport]);

  const surface = `bitchat-${transport}`;

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

  const handleBack = onBack ?? (() => router.back());

  const bubbleMessages = useMemo<ChatBubbleMessage[]>(
    () =>
      messages.map((m: ChatMessage) => ({
        id: m.id,
        content: m.content,
        senderId: m.senderId,
        sender: m.sender,
        timestamp: m.timestamp,
        isOwn: m.isOwn,
        deliveryStatus: m.isOwn ? (m.isPending ? 'sending' : 'sent') : undefined,
        cashuToken: extractCashuToken(m.content) ?? undefined,
      })),
    [messages]
  );

  const header = isDM ? (
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
  );

  return (
    <ChatScreen
      surface={surface}
      log={bitchatLog}
      header={header}
      messages={bubbleMessages}
      onSend={sendMessage}
      composerPlaceholder="Write here"
      emptyContent={
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
  );
}
