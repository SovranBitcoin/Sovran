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
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';

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
import { useBluetoothState } from '../hooks/useBluetoothState';
import { BluetoothInlineNotice } from '../components/BluetoothNotice';
import {
  ChatMessageBubble,
  ChatScreen,
  DmChatHeader,
  extractCashuToken,
  type ChatBubbleMessage,
} from '@/shared/ui/composed/chat';
import { Screen } from '@/shared/ui/composed/Screen';
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

  const [foreground, surfaceSecondary, shade400, shade500, accent, accentForeground] =
    useThemeColor([
      'foreground',
      'surface-secondary',
      'shade-400',
      'shade-500',
      'accent',
      'accent-foreground',
    ] as const);

  const { messages, isConnected, sendMessage } = useBitChat(
    geohash,
    transport,
    dmPeerID ? { dm: { peerID: dmPeerID, nickname: dmNickname } } : undefined
  );
  // Always call; the hook is safe when BLE isn't running. We use the peer
  // list for two things: the peer-count badge on the mesh tier header, and
  // the reachability banner above the BLE-DM composer.
  const { peers: blePeers, connectedCount: bleConnectedCount } = useBLEPeers();
  const bluetooth = useBluetoothState();
  const dmPeerSnapshot = useMemo(
    () =>
      transport === 'ble-dm' && dmPeerID ? blePeers.find((p) => p.peerID === dmPeerID) : undefined,
    [blePeers, transport, dmPeerID]
  );

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
    : transport === 'ble'
      ? 'Bitchat'
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
      messages.map((m: ChatMessage) => {
        // `ble-dm` messages carry a richer `deliveryStatus` from the global
        // store; all other transports just have `isPending`. Cast to read
        // the optional field without forcing every ChatMessage shape to
        // declare it.
        const richStatus = (m as { deliveryStatus?: ChatBubbleMessage['deliveryStatus'] })
          .deliveryStatus;
        const deliveryStatus: ChatBubbleMessage['deliveryStatus'] | undefined = m.isOwn
          ? (richStatus ?? (m.isPending ? 'sending' : 'sent'))
          : undefined;
        return {
          id: m.id,
          content: m.content,
          senderId: m.senderId,
          sender: m.sender,
          timestamp: m.timestamp,
          isOwn: m.isOwn,
          deliveryStatus,
          cashuToken: extractCashuToken(m.content) ?? undefined,
        };
      }),
    [messages]
  );

  const header = isDM ? (
    <DmChatHeader
      pubkey={isNostrPubkey ? dmPeerID : undefined}
      nickname={dmNickname}
      displayName={dmNickname || (dmPeerID ? dmPeerID.slice(0, 12) : undefined)}
      seed={dmPeerID}
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
        headerTitleAlign: 'center',
        title,
        headerLeft: () => (
          <Pressable onPress={handleBack} hitSlop={8}>
            <Icon name="material-symbols:arrow-back-rounded" size={24} color={foreground} />
          </Pressable>
        ),
        headerRight: () =>
          transport === 'ble' ? (
            <Pressable
              onPress={() => router.push('/(user-flow)/bitchatNetwork')}
              hitSlop={8}
              style={{ padding: 8 }}>
              <View>
                <Icon
                  name="mdi:account-group"
                  size={22}
                  color={bleConnectedCount > 0 ? foreground : shade400}
                />
                {bleConnectedCount > 0 && (
                  <View
                    style={{
                      position: 'absolute',
                      right: -6,
                      top: -4,
                      minWidth: 16,
                      height: 16,
                      paddingHorizontal: 4,
                      borderRadius: 8,
                      backgroundColor: accent,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    <Text
                      size={10}
                      style={{
                        color: accentForeground,
                        fontWeight: '700',
                        lineHeight: 12,
                      }}>
                      {bleConnectedCount}
                    </Text>
                  </View>
                )}
              </View>
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

  // Bluetooth readiness gates both BLE transports — when the radio is off or
  // unauthorized, peer-reachability states below are meaningless, so the
  // Bluetooth banner takes precedence. Relay-based nostr transports are
  // unaffected.
  const isBleTransport = transport === 'ble' || transport === 'ble-dm';
  const bluetoothBlocked =
    isBleTransport && bluetooth.status !== 'ready' && bluetooth.status !== 'unknown';

  // Surface peer reachability for BLE-DM so users aren't surprised when a
  // "connected" peer's DM stalls. Three states map cleanly to upstream's
  // transport behavior:
  //   - direct link    → no banner (DMs go straight over BLE)
  //   - mesh-only      → warning banner (DMs mesh-flood; 15s spool)
  //   - unknown/offline → muted banner (peer not currently nearby)
  let bleDmBanner: React.ReactNode = null;
  if (bluetoothBlocked) {
    bleDmBanner = <BluetoothInlineNotice bluetooth={bluetooth} />;
  } else if (transport === 'ble-dm') {
    const isMeshOnly =
      !!dmPeerSnapshot && dmPeerSnapshot.isConnected && dmPeerSnapshot.hasDirectLink === false;
    const isUnknownOrOffline = !dmPeerSnapshot || !dmPeerSnapshot.isConnected;
    if (isMeshOnly) {
      bleDmBanner = (
        <HStack
          spacing={8}
          align="center"
          style={{
            paddingHorizontal: 16,
            paddingVertical: 10,
            backgroundColor: surfaceSecondary,
          }}>
          <Icon name="mdi:lan-disconnect" size={16} color={shade400} />
          <Text size={12} style={{ color: shade400, flex: 1 }} numberOfLines={2}>
            Reachable only via mesh relay — messages may take several attempts.
          </Text>
        </HStack>
      );
    } else if (isUnknownOrOffline) {
      bleDmBanner = (
        <HStack
          spacing={8}
          align="center"
          style={{
            paddingHorizontal: 16,
            paddingVertical: 10,
            backgroundColor: surfaceSecondary,
          }}>
          <Icon name="mdi:bluetooth-off" size={16} color={shade400} />
          <Text size={12} style={{ color: shade400, flex: 1 }} numberOfLines={2}>
            Peer is not currently nearby — your message will be queued briefly.
          </Text>
        </HStack>
      );
    }
  }

  return (
    <Screen name="GeohashChatScreen" scroll="none">
      {header}
      {bleDmBanner}
      <ChatScreen
        surface={surface}
        log={bitchatLog}
        messages={bubbleMessages}
        onSend={sendMessage}
        composerPlaceholder="Write here"
        renderBubble={
          transport === 'ble-dm'
            ? ({ message: m, isFirstInGroup, isLastInGroup }) => {
                // Look up the original content from `messages` so retry
                // re-dispatches the exact text the user typed (the bubble's
                // `content` may have been stripped of an embedded cashu
                // token in `bubbleMessages`).
                const original = messages.find((src) => src.id === m.id);
                const handleRetry =
                  m.deliveryStatus === 'failed' && original
                    ? () => {
                        bitchatLog.info('bitchat.screen.ble_dm_retry', {
                          messageID: m.id,
                        });
                        void sendMessage(original.content);
                      }
                    : undefined;
                return (
                  <ChatMessageBubble
                    message={m}
                    isFirstInGroup={isFirstInGroup}
                    isLastInGroup={isLastInGroup}
                    onRetry={handleRetry}
                  />
                );
              }
            : undefined
        }
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
    </Screen>
  );
}
