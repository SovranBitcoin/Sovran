import React, { useCallback, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { LegendList } from '@legendapp/list/react-native';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import type { BLEPeer } from 'bitchat-module';
import { usePaymentFlowMachine } from '@sovranbitcoin/colada/react';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { useBLEPeers } from '@/features/bitchat/hooks/useBLEPeers';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { resolveIdentityName } from '@/shared/lib/identity';
import { BLUETOOTH_ACCENT } from '@/shared/lib/brandColors';
import { paymentLog, useLifecycleLogger } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useNearPaySessionStore } from '@/shared/stores/runtime/nearPayStore';
import { ContactRow, bleIdentity } from '@/shared/ui/composed/ContactRow';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

const STACK_OPTIONS = {
  title: 'Nearby',
  headerTransparent: true,
  headerShadowVisible: false,
};

function peerDisplayName(peer: BLEPeer): string {
  return resolveIdentityName({
    pubkey: peer.peerID,
    bleNickname: peer.nickname,
  });
}

interface NearPayPeerRowProps {
  peer: BLEPeer;
  onSelect: (peer: BLEPeer) => void;
}

function NearPayPeerRow({ peer, onSelect }: NearPayPeerRowProps) {
  const handlePress = useCallback(() => onSelect(peer), [onSelect, peer]);
  const identity = useMemo(() => bleIdentity({ ...peer }), [peer]);

  return (
    <ContactRow
      identity={identity}
      onPress={handlePress}
      testID={`near-pay-peer-row:${peer.peerID}`}
    />
  );
}

export function NearPayPeerListScreen() {
  useLifecycleLogger('NearPayPeerListScreen', paymentLog);
  const headerHeight = useHeaderHeight();
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext, unit: 'sat' });
  const { peers } = useBLEPeers();
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);

  // Nut Drop is Sovran-to-Sovran: tokens are P2PK-locked to the recipient's
  // announced lock key, so vanilla bitchat peers (no SVRN announce extension)
  // can't receive a drop and are hidden from this list entirely.
  const sovranPeers = useMemo(
    () => peers.filter((peer) => peer.isSovranPeer && !!peer.p2pkPubkeyHex),
    [peers]
  );
  const vanillaPeerCount = peers.length - sovranPeers.length;
  const connectedCount = useMemo(
    () => sovranPeers.filter((peer) => peer.isConnected).length,
    [sovranPeers]
  );
  const directLinkCount = useMemo(
    () => sovranPeers.filter((peer) => peer.hasDirectLink).length,
    [sovranPeers]
  );
  const sortedPeers = useMemo(() => {
    return [...sovranPeers].sort((a, b) => {
      if (a.hasDirectLink !== b.hasDirectLink) return a.hasDirectLink ? -1 : 1;
      if (a.isConnected !== b.isConnected) return a.isConnected ? -1 : 1;
      return b.lastSeen - a.lastSeen;
    });
  }, [sovranPeers]);

  const subtitleText = useMemo(() => {
    if (sovranPeers.length === 0) return 'Scanning for nearby Sovran users...';
    if (connectedCount === 0) return `${sovranPeers.length} nearby · 0 connected`;
    if (directLinkCount === connectedCount) {
      return `${connectedCount} connected · ${sovranPeers.length} nearby`;
    }
    return `${directLinkCount} direct · ${connectedCount - directLinkCount} mesh · ${sovranPeers.length} nearby`;
  }, [connectedCount, directLinkCount, sovranPeers.length]);

  const rootStyle = useMemo(() => [styles.root, { backgroundColor: background }], [background]);
  const contentStyle = useMemo(
    () => [styles.content, { paddingTop: headerHeight }],
    [headerHeight]
  );
  const summaryStyle = useMemo(
    () => [styles.summary, { borderBottomColor: opacity(foreground, 0.08) }],
    [foreground]
  );
  const summaryTextStyle = useMemo(() => ({ color: opacity(foreground, 0.6) }), [foreground]);
  const emptyIconColor = useMemo(() => opacity(foreground, 0.3), [foreground]);
  const emptyTitleStyle = useMemo(
    () => ({ color: opacity(foreground, 0.5), textAlign: 'center' as const }),
    [foreground]
  );
  const emptyTextStyle = useMemo(
    () => ({ color: opacity(foreground, 0.35), textAlign: 'center' as const }),
    [foreground]
  );

  const handleSelectPeer = useCallback(
    (peer: BLEPeer) => {
      const displayName = peerDisplayName(peer);
      paymentLog.info('near_pay.peer.list_select', {
        peerID: peer.peerID,
        hasDirectLink: peer.hasDirectLink,
        isConnected: peer.isConnected,
      });
      const p2pkPubkeyHex = peer.p2pkPubkeyHex;
      if (!p2pkPubkeyHex) {
        // Should be unreachable — the list only renders Sovran peers — but a
        // missing lock key must never start an (unlockable) session.
        paymentLog.error('near_pay.peer.list_select_missing_p2pk', { peerID: peer.peerID });
        return;
      }
      useNearPaySessionStore.getState().start({
        peerID: peer.peerID,
        nickname: displayName,
        hasDirectLink: peer.hasDirectLink,
        lastSeen: peer.lastSeen,
        p2pkPubkeyHex,
      });
      router.back();
      void machine
        .startSendEcash({
          reset: true,
          p2pkLockPubkey: p2pkPubkeyHex,
          recipientProfile: {
            displayName,
            avatarUrl: null,
            nip05: null,
          },
        })
        .catch((err) => {
          useNearPaySessionStore.getState().clear();
          paymentLog.error('near_pay.peer.list_start_send_failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
    },
    [machine]
  );

  const renderItem = useCallback(
    ({ item }: { item: BLEPeer }) => <NearPayPeerRow peer={item} onSelect={handleSelectPeer} />,
    [handleSelectPeer]
  );
  const keyExtractor = useCallback((peer: BLEPeer) => peer.peerID, []);
  const emptyContent = useMemo(
    () => (
      <VStack align="center" spacing={12} style={styles.emptyState}>
        <Icon name="mdi:bluetooth" size={32} color={emptyIconColor} />
        <Text size={16} style={emptyTitleStyle}>
          No Sovran users nearby
        </Text>
        <Text size={13} style={emptyTextStyle}>
          {vanillaPeerCount > 0
            ? `Nut Drop needs both people on Sovran. ${vanillaPeerCount} nearby BitChat ${vanillaPeerCount === 1 ? 'user' : 'users'} can chat in the mesh instead.`
            : 'Keep Sovran open and nearby Sovran users will appear here.'}
        </Text>
      </VStack>
    ),
    [emptyIconColor, emptyTextStyle, emptyTitleStyle, vanillaPeerCount]
  );

  return (
    <View style={rootStyle}>
      <Stack.Screen options={STACK_OPTIONS} />
      <View style={contentStyle}>
        <HStack align="center" spacing={8} style={summaryStyle}>
          <Icon name="mdi:bluetooth" size={18} color={BLUETOOTH_ACCENT} />
          <Text size={13} style={summaryTextStyle}>
            {subtitleText}
          </Text>
        </HStack>
        <LegendList
          data={sortedPeers}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          estimatedItemSize={68}
          keyboardDismissMode="on-drag"
          style={styles.list}
          contentContainerStyle={peers.length === 0 ? styles.emptyListContent : styles.listContent}
          ListEmptyComponent={emptyContent}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  summary: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  emptyListContent: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 40,
  },
});
