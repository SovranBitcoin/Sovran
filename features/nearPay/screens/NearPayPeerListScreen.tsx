import React, { useCallback, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { LegendList } from '@legendapp/list/react-native';
import { router, Stack } from 'expo-router';
import type { BLEPeer } from 'bitchat-module';
import { usePaymentFlowMachine } from 'colada/react';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { useBLEPeers } from '@/features/bitchat/hooks/useBLEPeers';
import { getMockBLEPeerProfile } from '@/features/bitchat/lib/mockBLEPeers';
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
  const identity = useMemo(() => {
    const mockProfile = getMockBLEPeerProfile(peer.peerID);
    return bleIdentity({
      ...peer,
      ...(mockProfile?.picture ? { picture: mockProfile.picture } : {}),
    });
  }, [peer]);

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
  const { peers, connectedCount } = useBLEPeers();
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);

  const directLinkCount = useMemo(() => peers.filter((peer) => peer.hasDirectLink).length, [peers]);
  const sortedPeers = useMemo(() => {
    return [...peers].sort((a, b) => {
      if (a.hasDirectLink !== b.hasDirectLink) return a.hasDirectLink ? -1 : 1;
      if (a.isConnected !== b.isConnected) return a.isConnected ? -1 : 1;
      return b.lastSeen - a.lastSeen;
    });
  }, [peers]);

  const subtitleText = useMemo(() => {
    if (peers.length === 0) return 'Scanning for nearby BitChat users...';
    if (connectedCount === 0) return `${peers.length} nearby · 0 connected`;
    if (directLinkCount === connectedCount) {
      return `${connectedCount} connected · ${peers.length} nearby`;
    }
    return `${directLinkCount} direct · ${connectedCount - directLinkCount} mesh · ${peers.length} nearby`;
  }, [connectedCount, directLinkCount, peers.length]);

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
      const mockProfile = getMockBLEPeerProfile(peer.peerID);
      paymentLog.info('near_pay.peer.list_select', {
        peerID: peer.peerID,
        hasDirectLink: peer.hasDirectLink,
        isConnected: peer.isConnected,
      });
      useNearPaySessionStore.getState().start({
        peerID: peer.peerID,
        nickname: displayName,
        hasDirectLink: peer.hasDirectLink,
        lastSeen: peer.lastSeen,
      });
      router.back();
      void machine
        .startSendEcash({
          reset: true,
          recipientProfile: {
            displayName,
            avatarUrl: mockProfile?.picture ?? null,
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
          No nearby users yet
        </Text>
        <Text size={13} style={emptyTextStyle}>
          Keep Sovran open and nearby BitChat users will appear here.
        </Text>
      </VStack>
    ),
    [emptyIconColor, emptyTextStyle, emptyTitleStyle]
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
