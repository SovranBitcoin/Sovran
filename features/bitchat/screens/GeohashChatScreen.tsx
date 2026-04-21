/**
 * @fileoverview Geohash-based location chat screen
 *
 * Visually matches UserMessagesScreen but powered by BitChat's
 * geohash Nostr protocol (kind 20000 ephemeral events with #g tag).
 * Reuses the same UI primitives for a consistent look.
 */

import React, { useState, useRef, useCallback, useMemo } from 'react';
import { Pressable, Dimensions } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import { LegendList } from '@legendapp/list';
import opacity from 'hex-color-opacity';

import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import TextInput from '@/shared/ui/primitives/TextInput';
import Icon from 'assets/icons';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Screen, useLifecycleLogger, log } from '@/shared/lib/logger';
import { useBitChat } from '../hooks/useBitChat';
import { useBLEPeers } from '../hooks/useBLEPeers';

const bitchatLog = log.child({ module: 'bitchat' });
import type { ChatMessage } from 'bitchat-module';
import { LOCATION_TIERS } from '../lib/constants';

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

  if (diffInHours < 24) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffInHours < 48) {
    return 'Yesterday';
  } else {
    return date.toLocaleDateString();
  }
}

// ===========================
// MESSAGE BUBBLE
// ===========================

interface GeohashMessageBubbleProps {
  message: ChatMessage;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
}

function GeohashMessageBubble({ message, isFirstInGroup, isLastInGroup }: GeohashMessageBubbleProps) {
  const [foreground, defaultColor, surfaceTertiary, shade400] = useThemeColor([
    'foreground',
    'default',
    'surface-tertiary',
    'shade-400',
  ] as const);

  const showAvatar = !message.isOwn && isLastInGroup;
  const showName = !message.isOwn && isFirstInGroup;
  const showTimestamp = isLastInGroup;

  // Grouped bubbles: tight spacing within group, normal spacing between groups
  const marginBottom = isLastInGroup ? 16 : 2;

  // Bubble corner radii — rounded on outer edges, tight on inner stacking edges
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
              name={message.sender}
            />
          ) : (
            <View style={{ width: 32 }} />
          )
        )}

        <VStack
          align={message.isOwn ? 'flex-end' : 'flex-start'}
          spacing={2}
          style={{ flex: 1, maxWidth: '85%' }}>
          {showName && (
            <Text size={12} bold style={{ color: shade400, marginBottom: 2 }}>
              {message.sender}
            </Text>
          )}

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

          {showTimestamp && (
            <Text
              size={11}
              style={{
                color: shade400,
                alignSelf: message.isOwn ? 'flex-end' : 'flex-start',
                marginTop: 2,
              }}>
              {formatTimestamp(message.timestamp)}
            </Text>
          )}
        </VStack>
      </HStack>
    </VStack>
  );
}

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
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const listRef = useRef<any>(null);

  const [
    foreground,
    muted,
    accent,
    defaultColor,
    surfaceTertiary,
    surfaceSecondary,
    surface,
    shade400,
    shade500,
  ] = useThemeColor([
    'foreground',
    'muted',
    'accent',
    'default',
    'surface-tertiary',
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

  const tierDef = useMemo(
    () => LOCATION_TIERS.find((t) => t.label === tierLabel),
    [tierLabel]
  );

  // Precompute grouping: consecutive messages from the same sender form a group
  const groupingMap = useMemo(() => {
    const map = new Map<string, { isFirst: boolean; isLast: boolean }>();
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const prev = i > 0 ? messages[i - 1] : null;
      const next = i < messages.length - 1 ? messages[i + 1] : null;
      const isFirst = !prev || prev.senderPubkey !== msg.senderPubkey;
      const isLast = !next || next.senderPubkey !== msg.senderPubkey;
      map.set(msg.id, { isFirst, isLast });
    }
    return map;
  }, [messages]);

  const handleSendMessage = useCallback(async () => {
    const text = messageText.trim();
    if (!text || isSending) return;

    setIsSending(true);
    setMessageText('');
    try {
      await sendMessage(text);
    } finally {
      setIsSending(false);
    }
  }, [messageText, isSending, sendMessage]);

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

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
      style={{ flex: 1 }}>
      <Screen name="GeohashChatScreen">
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
              // DM transports own their own header space — no peer pill.
              isDM ? null : transport === 'ble' ? (
                // Tappable peer-count pill for the mesh chat. Mirrors
                // upstream bitchat's header icon+count affordance that
                // opens the Network sheet.
                <Pressable
                  onPress={() => router.push('/(user-flow)/bitchatNetwork' as any)}
                  hitSlop={8}>
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

        <View style={{ flex: 1, backgroundColor: surface }}>
          {/* Messages */}
          <LegendList
            ref={listRef}
            data={messages}
            renderItem={({ item }: { item: ChatMessage }) => {
              const group = groupingMap.get(item.id);
              return (
                <GeohashMessageBubble
                  message={item}
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

          {/* Input Area — matches UserMessagesScreen layout */}
          <View
            style={{
              backgroundColor: surfaceSecondary,
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: insets.bottom,
              borderTopWidth: 1,
              borderTopColor: surfaceTertiary,
            }}>
            <HStack align="center" spacing={12}>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: opacity(accent, 0.12),
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <Icon
                  name="mdi:map-marker"
                  size={18}
                  color={accent}
                />
              </View>

              <TextInput
                value={messageText}
                onChangeText={setMessageText}
                placeholder="Type a message..."
                style={{
                  flex: 1,
                  backgroundColor: surfaceTertiary,
                  borderRadius: 20,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  color: foreground,
                  fontSize: 16,
                  borderWidth: 0,
                  margin: 0,
                  shadowOpacity: 0,
                }}
                multiline
                maxLength={1000}
                returnKeyType="send"
                onSubmitEditing={handleSendMessage}
              />

              <Pressable
                onPress={handleSendMessage}
                disabled={!messageText.trim() || isSending}>
                <Icon
                  name="iconamoon:send-fill"
                  size={24}
                  color={messageText.trim() && !isSending ? foreground : shade500}
                />
              </Pressable>
            </HStack>
          </View>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
