import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  BLE_PEER_FRESHNESS_TICK_MS,
  filterFreshBLEPeers,
} from '@/features/bitchat/lib/blePeerSnapshots';
import { peerDisplayName } from '@/features/nearPay/lib/peerProfile';
import {
  confirmBearerSend,
  confirmPublicBroadcastSend,
} from '@/features/nearPay/lib/startNearPaySend';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { staticPopup } from '@/shared/lib/popup';
import { BLUETOOTH_ACCENT } from '@/shared/lib/brandColors';
import { paymentLog, useLifecycleLogger } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useNearPaySessionStore, type NearPayDelivery } from '@/shared/stores/runtime/nearPayStore';
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

interface NearPayPeerRowProps {
  peer: BLEPeer;
  onSelect: (peer: BLEPeer) => void;
}

/** Trailing pill marking vanilla bitchat peers — drops to them are bearer tokens. */
function BearerTag() {
  const [foreground] = useThemeColor(['foreground'] as const);
  const tagStyle = useMemo(
    () => [styles.bearerTag, { backgroundColor: opacity(foreground, 0.08) }],
    [foreground]
  );
  const tagTextStyle = useMemo(() => ({ color: opacity(foreground, 0.55) }), [foreground]);

  return (
    <HStack align="center" spacing={4} style={tagStyle}>
      <Icon name="mdi:lock-open-variant-outline" size={12} color={opacity(foreground, 0.55)} />
      <Text size={11} style={tagTextStyle}>
        Bearer
      </Text>
    </HStack>
  );
}

function NearPayPeerRow({ peer, onSelect }: NearPayPeerRowProps) {
  const handlePress = useCallback(() => onSelect(peer), [onSelect, peer]);
  // BLE identity only: the v2 capability beacon carries no key material, so
  // there is no Nostr identity to resolve until send time (the NUT-18
  // request reveals the recipient's lock key).
  const identity = useMemo(() => bleIdentity({ ...peer }), [peer]);
  const trailing = useMemo(
    () => (peer.supportsNutRequests ? undefined : <BearerTag />),
    [peer.supportsNutRequests]
  );

  return (
    <ContactRow
      identity={identity}
      trailing={trailing}
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
  const { isOffline } = useOfflineStatus();
  const { peers: blePeers } = useBLEPeers();
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);

  // Ghost entries (a nearby device's previous profile identities) are
  // dropped by the freshness filter — same rule as the radar; the tick
  // re-evaluates it as lastSeen values age out.
  const [peerFreshnessNow, setPeerFreshnessNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setPeerFreshnessNow(Date.now()), BLE_PEER_FRESHNESS_TICK_MS);
    return () => clearInterval(interval);
  }, []);
  const peers = useMemo(
    () => filterFreshBLEPeers(blePeers, peerFreshnessNow),
    [blePeers, peerFreshnessNow]
  );

  // Every bitchat peer is listed: peers whose capability beacon answers
  // NUT-18 solicits get locked in-band drops; vanilla peers are
  // public-broadcast bearer only (tagged, and gated behind an explicit
  // confirm in handleSelectPeer).
  const connectedCount = useMemo(() => peers.filter((peer) => peer.isConnected).length, [peers]);
  const directLinkCount = useMemo(() => peers.filter((peer) => peer.hasDirectLink).length, [peers]);
  const sortedPeers = useMemo(() => {
    return [...peers].sort((a, b) => {
      if (a.supportsNutRequests !== b.supportsNutRequests) return a.supportsNutRequests ? -1 : 1;
      if (a.hasDirectLink !== b.hasDirectLink) return a.hasDirectLink ? -1 : 1;
      if (a.isConnected !== b.isConnected) return a.isConnected ? -1 : 1;
      return b.lastSeen - a.lastSeen;
    });
  }, [peers]);

  const subtitleText = useMemo(() => {
    if (peers.length === 0) return 'Scanning for nearby people...';
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
    async (peer: BLEPeer) => {
      const displayName = peerDisplayName(peer);
      // Consent gates BEFORE any session or navigation state — declining
      // must leave the list exactly as it was. Locked mesh sends need no
      // consent (the token is locked to the key the recipient issues).
      let delivery: NearPayDelivery;
      if (!peer.supportsNutRequests) {
        const confirmed = await confirmPublicBroadcastSend(displayName);
        if (!confirmed) {
          paymentLog.info('near_pay.peer.broadcast_declined', { peerID: peer.peerID });
          return;
        }
        delivery = { mode: 'broadcast' };
      } else if (isOffline) {
        const confirmed = await confirmBearerSend(displayName);
        if (!confirmed) {
          paymentLog.info('near_pay.peer.bearer_declined', { peerID: peer.peerID });
          return;
        }
        delivery = { mode: 'mesh', locked: false };
      } else {
        delivery = { mode: 'mesh', locked: true };
      }
      paymentLog.info('near_pay.peer.list_select', {
        peerID: peer.peerID,
        hasDirectLink: peer.hasDirectLink,
        isConnected: peer.isConnected,
        deliveryMode: delivery.mode,
      });
      useNearPaySessionStore.getState().start({
        peerID: peer.peerID,
        nickname: displayName,
        hasDirectLink: peer.hasDirectLink,
        lastSeen: peer.lastSeen,
        delivery,
      });
      router.back();
      const startPromise =
        delivery.mode === 'mesh'
          ? machine
              .startMeshSend(peer.peerID, { reset: true, offline: !delivery.locked })
              .then((result) => {
                if (result.kind === 'started') return;
                if (result.kind === 'abort' && result.reason === 'no-mint-overlap') {
                  staticPopup('mesh-no-mint-overlap');
                } else {
                  staticPopup('mesh-solicit-failed');
                }
                useNearPaySessionStore.getState().clear();
              })
          : machine.startSendEcash({
              reset: true,
              recipientProfile: { displayName, avatarUrl: null, nip05: null },
            });
      void startPromise.catch((err) => {
        useNearPaySessionStore.getState().clear();
        paymentLog.error('near_pay.peer.list_start_send_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    },
    [machine, isOffline]
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
          No one nearby
        </Text>
        <Text size={13} style={emptyTextStyle}>
          Keep the app open and nearby BitChat users will appear here.
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
  bearerTag: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
});
