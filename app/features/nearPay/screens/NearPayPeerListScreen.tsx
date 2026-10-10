import { useStartNearbySend } from '@/features/nearPay/hooks/useStartNearbySend';
import { StyleSheet } from 'react-native';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import type { BLEPeer } from 'bitchat-module';
import { withAlpha } from '@/shared/lib/color';

import Icon from 'assets/icons';
import { useFreshNearbyPeers } from '@/features/nearPay/hooks/useFreshNearbyPeers';
import { NearbyPeerRow } from '@/features/nearPay/components/NearbyPeerRow';

import { BLUETOOTH_ACCENT } from '@/shared/lib/brandColors';
import { Log, paymentLog, useLifecycleLogger } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { List } from '@/shared/ui/composed/List';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

const STACK_OPTIONS = {
  title: 'Nearby',
  headerTransparent: true,
  headerShadowVisible: false,
};

interface NearPayPeerRowProps {
  peer: BLEPeer;
  onSelect: (peer: BLEPeer) => void;
}

function sortPeersByReadiness(peers: BLEPeer[]): BLEPeer[] {
  return [...peers].sort((a, b) => {
    if (a.hasDirectLink !== b.hasDirectLink) return a.hasDirectLink ? -1 : 1;
    if (a.isConnected !== b.isConnected) return a.isConnected ? -1 : 1;
    return b.lastSeen - a.lastSeen;
  });
}

function peerListSubtitle(total: number, connectedCount: number, directLinkCount: number): string {
  if (total === 0) return 'Scanning for nearby people...';
  if (connectedCount === 0) return `${total} nearby · 0 connected`;
  if (directLinkCount === connectedCount) {
    return `${connectedCount} connected · ${total} nearby`;
  }
  return `${directLinkCount} direct · ${connectedCount - directLinkCount} mesh · ${total} nearby`;
}

const peerKeyExtractor = (peer: BLEPeer) => peer.peerID;

function NearPayPeerRow({ peer, onSelect }: NearPayPeerRowProps) {
  return (
    <NearbyPeerRow
      peer={peer}
      onPress={() => onSelect(peer)}
      testID={`near-pay-peer-row:${peer.peerID}`}
    />
  );
}

export function NearPayPeerListScreen() {
  useLifecycleLogger('NearPayPeerListScreen', paymentLog);
  const headerHeight = useHeaderHeight();
  const [foreground, background] = useThemeColor(['foreground', 'surface'] as const);

  const peers = useFreshNearbyPeers();

  // The shared directory exposes authenticated payment recipients only.
  const connectedCount = peers.filter((peer) => peer.isConnected).length;
  const directLinkCount = peers.filter((peer) => peer.hasDirectLink).length;
  const sortedPeers = sortPeersByReadiness(peers);
  const subtitleText = peerListSubtitle(peers.length, connectedCount, directLinkCount);

  const rootStyle = [styles.root, { backgroundColor: background }];
  const contentStyle = [styles.content, { paddingTop: headerHeight }];
  const summaryStyle = [styles.summary, { borderBottomColor: withAlpha(foreground, 0.08) }];
  const summaryTextStyle = { color: withAlpha(foreground, 0.6) };
  const emptyIconColor = withAlpha(foreground, 0.3);
  const emptyTitleStyle = { color: withAlpha(foreground, 0.5), textAlign: 'center' as const };
  const emptyTextStyle = { color: withAlpha(foreground, 0.35), textAlign: 'center' as const };

  const startNearbySend = useStartNearbySend();
  const handleSelectPeer = (peer: BLEPeer) => startNearbySend(peer, () => router.back());

  const renderItem = ({ item }: { item: BLEPeer }) => (
    <NearPayPeerRow peer={item} onSelect={handleSelectPeer} />
  );
  const emptyContent = (
    <VStack align="center" gap={12} style={styles.emptyState}>
      <Icon name="mdi:bluetooth" size={32} color={emptyIconColor} />
      <Text size={16} style={emptyTitleStyle}>
        No one nearby
      </Text>
      <Text size={13} style={emptyTextStyle}>
        Nearby wallets that accept locked payments will appear here.
      </Text>
    </VStack>
  );

  return (
    <Log name="NearPayPeerListScreen" logger={paymentLog} style={rootStyle}>
      <Stack.Screen options={STACK_OPTIONS} />
      <View style={contentStyle}>
        <HStack align="center" gap={8} style={summaryStyle}>
          <Icon name="mdi:bluetooth" size={18} color={BLUETOOTH_ACCENT} />
          <Text size={13} style={summaryTextStyle}>
            {subtitleText}
          </Text>
        </HStack>
        <List
          screen
          bottomSpacing={24}
          data={sortedPeers}
          keyExtractor={peerKeyExtractor}
          renderItem={renderItem}
          keyboardDismissMode="on-drag"
          style={styles.list}
          contentContainerStyle={peers.length === 0 ? styles.emptyListContent : undefined}
          ListEmptyComponent={emptyContent}
        />
      </View>
    </Log>
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
