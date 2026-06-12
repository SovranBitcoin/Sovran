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
import {
  useRecentPeopleProfiles,
  type RecentPeopleProfileRow,
} from '@/features/feed/hooks/useRecentPeopleProfiles';
import { peerDisplayName, peerNostrPubkey } from '@/features/nearPay/lib/peerProfile';
import {
  confirmBearerSend,
  nearPaySendPlan,
  planDelivery,
} from '@/features/nearPay/lib/startNearPaySend';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { BLUETOOTH_ACCENT } from '@/shared/lib/brandColors';
import { paymentLog, useLifecycleLogger } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useNearPaySessionStore } from '@/shared/stores/runtime/nearPayStore';
import { ContactRow, bleIdentity, nostrIdentity } from '@/shared/ui/composed/ContactRow';
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
  profile?: RecentPeopleProfileRow;
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

function NearPayPeerRow({ peer, profile, onSelect }: NearPayPeerRowProps) {
  const handlePress = useCallback(() => onSelect(peer), [onSelect, peer]);
  // BLE identity stays primary (peerID seed, connection status); the Nostr
  // identity layers in the kind-0 profile (name/picture) and drives
  // ContactRow's standard skeleton while the profile fetch is in flight —
  // the identicon never flashes before the fetch resolves.
  const identity = useMemo(() => {
    const ble = bleIdentity({ ...peer });
    const nostrPubkey = peerNostrPubkey(peer);
    if (!nostrPubkey) return ble;
    return [
      ble,
      nostrIdentity(nostrPubkey, profile?.metadata, { isLoadingProfile: profile?.isLoading }),
    ];
  }, [peer, profile]);
  const trailing = useMemo(
    () => (peer.supportsP2pkEcash ? undefined : <BearerTag />),
    [peer.supportsP2pkEcash]
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

  // Every bitchat peer is listed: peers announcing the ecash capability TLV
  // get P2PK-locked drops; vanilla peers are bearer-only (tagged, and gated
  // behind an explicit confirm in handleSelectPeer).
  const connectedCount = useMemo(() => peers.filter((peer) => peer.isConnected).length, [peers]);
  const directLinkCount = useMemo(() => peers.filter((peer) => peer.hasDirectLink).length, [peers]);
  const sortedPeers = useMemo(() => {
    return [...peers].sort((a, b) => {
      if (a.supportsP2pkEcash !== b.supportsP2pkEcash) return a.supportsP2pkEcash ? -1 : 1;
      if (a.hasDirectLink !== b.hasDirectLink) return a.hasDirectLink ? -1 : 1;
      if (a.isConnected !== b.isConnected) return a.isConnected ? -1 : 1;
      return b.lastSeen - a.lastSeen;
    });
  }, [peers]);

  // Batch-fetch kind-0 profiles for all visible peers via nagg (warms the
  // shared nostrMetadataCache; cache hits render instantly). Vanilla peers
  // have no Nostr pubkey and drop out of the fetch.
  const peerNostrPubkeys = useMemo(() => peers.map(peerNostrPubkey).filter(Boolean), [peers]);
  const profileRows = useRecentPeopleProfiles(peerNostrPubkeys);
  const profileByPubkey = useMemo(
    () => new Map(profileRows.map((row) => [row.pubkey, row])),
    [profileRows]
  );

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
      const nostrPubkey = peerNostrPubkey(peer);
      const profile = profileByPubkey.get(nostrPubkey);
      const displayName = peerDisplayName(peer, profile);
      const plan = nearPaySendPlan(peer);
      paymentLog.info('near_pay.peer.list_select', {
        peerID: peer.peerID,
        hasDirectLink: peer.hasDirectLink,
        isConnected: peer.isConnected,
        deliveryMode: plan.mode,
      });
      if (plan.mode === 'bearer') {
        // Consent gate BEFORE any session or navigation state — declining
        // must leave the list exactly as it was.
        const confirmed = await confirmBearerSend(displayName);
        if (!confirmed) {
          paymentLog.info('near_pay.peer.bearer_declined', { peerID: peer.peerID });
          return;
        }
      }
      useNearPaySessionStore.getState().start({
        peerID: peer.peerID,
        nickname: displayName,
        hasDirectLink: peer.hasDirectLink,
        lastSeen: peer.lastSeen,
        delivery: planDelivery(plan),
      });
      router.back();
      void machine
        .startSendEcash({
          reset: true,
          // Bearer plans omit the lock — deliverNearPayIfActive enforces the
          // completed send is lock-free before broadcasting.
          ...(plan.mode === 'p2pk'
            ? { p2pkLockPubkey: plan.p2pkLockPubkey, recipientPubkey: plan.recipientPubkey }
            : {}),
          recipientProfile: {
            displayName,
            avatarUrl: profile?.metadata?.picture ?? null,
            nip05: profile?.metadata?.nip05 ?? null,
          },
        })
        .catch((err) => {
          useNearPaySessionStore.getState().clear();
          paymentLog.error('near_pay.peer.list_start_send_failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
    },
    [machine, profileByPubkey]
  );

  const renderItem = useCallback(
    ({ item }: { item: BLEPeer }) => (
      <NearPayPeerRow
        peer={item}
        profile={profileByPubkey.get(peerNostrPubkey(item))}
        onSelect={handleSelectPeer}
      />
    ),
    [handleSelectPeer, profileByPubkey]
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
