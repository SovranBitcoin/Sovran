/**
 * @fileoverview Bluetooth mesh network / peer list
 *
 * Upstream bitchat's equivalent is `MeshPeerList` (`bitchat/Views/MeshPeerList.swift`)
 * — a sheet showing everyone visible on the current mesh. We mirror the
 * same info density: nickname, connection state, last-seen, antenna icon.
 */

import React, { useCallback, useMemo } from 'react';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { StyleSheet } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log, useLifecycleLogger, bitchatLog } from '@/shared/lib/logger';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import type { BLEPeer } from 'bitchat-module';

import { ContactRow, bleIdentity } from '@/shared/ui/composed/ContactRow';
import { resolveIdentityName } from '@/shared/lib/identity';
import { BLUETOOTH_ACCENT } from '@/shared/lib/brandColors';
import { useBLEPeers } from '../hooks/useBLEPeers';

interface PeerRowProps {
  peer: BLEPeer;
}

function PeerRow({ peer }: PeerRowProps) {
  const displayName = resolveIdentityName({
    pubkey: peer.peerID,
    bleNickname: peer.nickname,
  });

  const openDM = () => {
    // Replace the Network sheet with the DM screen. `replace` (not `push`)
    // so back from DM returns to the chat, not to the peer list — matches
    // upstream bitchat's UX where the peer list is a sidebar that dismisses
    // on tap.
    router.replace({
      pathname: '/(user-flow)/bitchatDM',
      params: {
        transport: 'ble-dm',
        peerID: peer.peerID,
        nickname: displayName,
      },
    });
  };

  return (
    <ContactRow
      identity={bleIdentity(peer)}
      onPress={openDM}
      testID={`contact-row:ble:${peer.peerID}`}
    />
  );
}

export default function NetworkSheet() {
  useLifecycleLogger('BitchatNetworkSheet', bitchatLog);
  const [foreground, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface-secondary',
  ] as const);

  const { peers, connectedCount } = useBLEPeers();

  // Direct-link peers are the ones DMs can actually reach without bouncing
  // through the mesh-flood spool (which expires after 15s). Surface this
  // distinction in both the sort order and the header count so users don't
  // think "5 connected" means "5 reachable for DM".
  const directLinkCount = useMemo(() => peers.filter((p) => p.hasDirectLink).length, [peers]);

  // Sort: direct-link first, then mesh-reachable, then offline; ties broken
  // by lastSeen desc. Matches upstream's MeshPeerList preference for "best
  // reachability first".
  const sortedPeers = useMemo(() => {
    return [...peers].sort((a, b) => {
      if (a.hasDirectLink !== b.hasDirectLink) return a.hasDirectLink ? -1 : 1;
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
    if (directLinkCount === connectedCount) {
      return `${connectedCount} connected · ${peers.length} nearby`;
    }
    // Some peers are reachable only via mesh relay — call it out so users
    // know not every "connected" peer is good for a DM.
    return `${directLinkCount} direct · ${connectedCount - directLinkCount} mesh · ${peers.length} nearby`;
  }, [peers.length, connectedCount, directLinkCount]);

  return (
    <Log name="BitchatNetworkSheet" style={{ flex: 1 }}>
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
        style={{
          paddingHorizontal: 20,
          paddingVertical: 10,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: opacity(foreground, 0.08),
        }}>
        <Icon name="mdi:bluetooth" size={18} color={BLUETOOTH_ACCENT} />
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
        // LegendList needs an explicit flex:1 — the Screen wrapper only makes
        // itself flex:1, children still need to claim remaining height.
        style={{ flex: 1 }}
        contentContainerStyle={
          peers.length === 0
            ? { flexGrow: 1, justifyContent: 'center', alignItems: 'center' }
            : undefined
        }
        ListEmptyComponent={
          <VStack
            align="center"
            spacing={12}
            style={{ paddingHorizontal: 40, alignItems: 'center' }}>
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
    </Log>
  );
}
