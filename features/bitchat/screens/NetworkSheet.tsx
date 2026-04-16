/**
 * @fileoverview Bluetooth mesh network / peer list
 *
 * Upstream bitchat's equivalent is `MeshPeerList` (`bitchat/Views/MeshPeerList.swift`)
 * — a sheet showing everyone visible on the current mesh. We mirror the
 * same info density: nickname, connection state, last-seen, antenna icon.
 */

import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { LegendList } from '@legendapp/list';
import { router, Stack } from 'expo-router';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Screen, useLifecycleLogger } from '@/shared/lib/logger';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import type { BLEPeer } from 'bitchat-module';

import { ListRow } from '@/shared/ui/composed/ListRow';
import { useBLEPeers } from '../hooks/useBLEPeers';

function formatLastSeen(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs;
  if (diffMs < 0 || diffMs < 60_000) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface PeerRowProps {
  peer: BLEPeer;
}

function PeerRow({ peer }: PeerRowProps) {
  const [shade400] = useThemeColor(['shade-400'] as const);

  const displayName = peer.nickname?.trim() || peer.peerID.slice(0, 12);
  const subtitle = peer.isConnected
    ? `#${peer.peerID.slice(0, 8)} · connected`
    : `#${peer.peerID.slice(0, 8)} · seen ${formatLastSeen(peer.lastSeen)}`;

  return (
    <ListRow
      avatar={{ seed: peer.peerID, name: displayName }}
      title={displayName}
      subtitle={subtitle}
      trailing={
        <Icon
          name={peer.isConnected ? 'mdi:broadcast' : 'mdi:clock-outline'}
          size={20}
          color={peer.isConnected ? '#34C759' : shade400}
        />
      }
    />
  );
}

export default function NetworkSheet() {
  useLifecycleLogger('BitchatNetworkSheet');
  const [foreground, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface-secondary',
  ] as const);

  const { peers, connectedCount } = useBLEPeers();

  // Sort: connected first, then by lastSeen desc. Matches upstream's
  // MeshPeerList ordering where connected peers float to the top.
  const sortedPeers = useMemo(() => {
    return [...peers].sort((a, b) => {
      if (a.isConnected !== b.isConnected) return a.isConnected ? -1 : 1;
      return b.lastSeen - a.lastSeen;
    });
  }, [peers]);

  const handleClose = useCallback(() => {
    router.back();
  }, []);

  const subtitleText = useMemo(() => {
    if (peers.length === 0) return 'Scanning for devices…';
    if (connectedCount === 0) return `${peers.length} nearby · 0 connected`;
    return `${connectedCount} connected · ${peers.length} nearby`;
  }, [peers.length, connectedCount]);

  return (
    <Screen name="BitchatNetworkSheet" style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerShown: true,
          // Parent user-flow stack defaults to headerTransparent: true, which
          // makes the content render under the header and hides our subheader
          // + list. Override to get automatic top-inset behaviour.
          headerTransparent: false,
          headerStyle: { backgroundColor: surfaceSecondary },
          headerShadowVisible: false,
          headerBackVisible: false,
          headerTintColor: foreground,
          title: 'Network',
          headerLeft: () => (
            <Pressable onPress={handleClose} hitSlop={8}>
              <Icon name="material-symbols:close-rounded" size={24} color={foreground} />
            </Pressable>
          ),
        }}
      />

      <HStack
        align="center"
        spacing={8}
        style={[styles.subheader, { borderBottomColor: opacity(foreground, 0.08) }]}>
        <Icon name="mdi:bluetooth" size={18} color="#0A84FF" />
        <Text size={13} style={{ color: opacity(foreground, 0.6) }}>
          {subtitleText}
        </Text>
      </HStack>

      <LegendList
        data={sortedPeers}
        keyExtractor={(p) => p.peerID}
        renderItem={({ item }) => <PeerRow peer={item} />}
        estimatedItemSize={68}
        keyboardDismissMode="on-drag"
        style={styles.list}
        contentContainerStyle={peers.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={
          <VStack align="center" spacing={12} style={styles.emptyStack}>
            <Icon name="mdi:bluetooth" size={32} color={opacity(foreground, 0.3)} />
            <Text size={16} style={{ color: opacity(foreground, 0.5) }}>
              No devices found yet
            </Text>
            <Text size={13} style={{ color: opacity(foreground, 0.35) }}>
              Keep Sovran open; nearby bitchat users will appear as they connect.
            </Text>
          </VStack>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  subheader: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
  },
  list: {
    // LegendList needs an explicit flex:1 — the Screen wrapper only makes
    // itself flex:1, children still need to claim remaining height.
    flex: 1,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyStack: {
    paddingHorizontal: 40,
    alignItems: 'center',
  },
});
