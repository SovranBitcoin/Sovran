import { StyleSheet } from 'react-native';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import type { BLEPeer } from 'bitchat-module';
import { usePaymentFlowMachine } from 'wallet/react';
import { withAlpha } from '@/shared/lib/color';

import Icon from 'assets/icons';
import { useFreshNearbyPeers } from '@/features/nearPay/hooks/useFreshNearbyPeers';
import { peerDisplayName, peerIdentitySeed } from '@/features/nearPay/lib/peerProfile';
import { nearPayPeerTapLog, planNearPaySend } from '@/features/nearPay/lib/nearPaySendDecision';
import { lockableMintsFromCreq } from '@/shared/lib/nutCreq';
import {
  confirmBearerDowngrade,
  notifyNoSharedMint,
  notifyNutDropPeerNotReady,
} from '@/features/nearPay/lib/startNearPaySend';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { BLUETOOTH_ACCENT } from '@/shared/lib/brandColors';
import { paymentLog, useLifecycleLogger } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useNearPaySessionStore, type NearPayDelivery } from '@/shared/stores/runtime/nearPayStore';
import { ContactRow, bleIdentity } from '@/shared/ui/composed/ContactRow';
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

function peerHasValidCreq(peer: Pick<BLEPeer, 'creq' | 'nostrPubkeyHex'>): boolean {
  return lockableMintsFromCreq(peer.creq, peer.nostrPubkeyHex) !== null;
}

function sortPeersByReadiness(peers: BLEPeer[]): BLEPeer[] {
  return [...peers].sort((a, b) => {
    const aLockable = peerHasValidCreq(a);
    const bLockable = peerHasValidCreq(b);
    if (aLockable !== bLockable) return aLockable ? -1 : 1;
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

/** Trailing pill for peers that have not advertised the creq capability yet. */
function WaitingTag() {
  const [foreground] = useThemeColor(['foreground'] as const);
  const tagStyle = [styles.bearerTag, { backgroundColor: withAlpha(foreground, 0.08) }];
  const tagTextStyle = { color: withAlpha(foreground, 0.55) };

  return (
    <HStack align="center" gap={4} style={tagStyle}>
      <Icon name="mdi:lock-open-variant-outline" size={12} color={withAlpha(foreground, 0.55)} />
      <Text size={11} style={tagTextStyle}>
        Waiting
      </Text>
    </HStack>
  );
}

function NearPayPeerRow({ peer, onSelect }: NearPayPeerRowProps) {
  // Seed identity from the favorite-exchanged Nostr key when the peer is a
  // Sovran client; stock peers fall back to the noise-key pseudonym. The real
  // face resolves on the radar; this list stays BLE-name.
  const identity = bleIdentity({ ...peer, identitySeed: peerIdentitySeed(peer) });
  const trailing =
    lockableMintsFromCreq(peer.creq, peer.nostrPubkeyHex) !== null ? undefined : <WaitingTag />;

  return (
    <ContactRow
      identity={identity}
      trailing={trailing}
      onPress={() => onSelect(peer)}
      testID={`near-pay-peer-row:${peer.peerID}`}
    />
  );
}

export function NearPayPeerListScreen() {
  useLifecycleLogger('NearPayPeerListScreen', paymentLog);
  const headerHeight = useHeaderHeight();
  const walletContext = useWalletContext();
  // NearPay is sat-pinned at the protocol level — it does NOT follow the
  // wallet's active mint unit.
  const machine = usePaymentFlowMachine({ walletContext, unit: 'sat' });
  const { isOffline } = useOfflineStatus();
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);

  const peers = useFreshNearbyPeers();

  // Token DMs are only enabled after a peer advertises a valid creq capability.
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

  const handleSelectPeer = async (peer: BLEPeer) => {
    const displayName = peerDisplayName(peer);
    // Decide lock vs offline bearer from the peer's creq (accepted mints +
    // lock key), our trusted mints, and online status. Delivery is always a
    // private DM, but only after a valid creq proved the peer is patched.
    const plan = planNearPaySend({
      peer,
      ourMints: walletContext.trustedMintUrls,
      isOffline,
    });
    paymentLog.info('near_pay.peer.tap', {
      source: 'peer-list',
      ...nearPayPeerTapLog({ peer, plan, ourMints: walletContext.trustedMintUrls, isOffline }),
    });
    // No valid creq ⇒ not confirmed patched; no mint in common ⇒ the
    // recipient couldn't redeem. Block before any session/navigation state.
    if (plan.mode === 'block') {
      if (plan.reason === 'no-shared-mint') {
        await notifyNoSharedMint(displayName);
      } else {
        await notifyNutDropPeerNotReady(displayName);
      }
      return;
    }
    // Offline bearer downgrade is never silent: confirm before sending an
    // unlocked (bearer) token. (audit ND-2)
    if (plan.mode === 'bearer' && plan.requiresConsent) {
      const proceed = await confirmBearerDowngrade(displayName);
      if (!proceed) {
        paymentLog.info('near_pay.peer.bearer_downgrade_declined', { isOffline });
        return;
      }
    }
    const delivery: NearPayDelivery = { locked: plan.mode === 'lock' };
    useNearPaySessionStore.getState().start({
      peerID: peer.peerID,
      nickname: displayName,
      hasDirectLink: peer.hasDirectLink,
      lastSeen: peer.lastSeen,
      creq: peer.creq,
      delivery,
    });
    // Failure paths must only unwind THIS selection — a newer session
    // started meanwhile must survive a stale failure.
    const sessionId = useNearPaySessionStore.getState().active?.id ?? null;
    const clearOwnSession = () => {
      if (useNearPaySessionStore.getState().active?.id === sessionId) {
        useNearPaySessionStore.getState().clear();
      }
    };
    router.back();
    // The sendComplete handler delivers the finished token as a private Noise
    // DM to the recipient peer (no public mesh). A locked token is P2PK-locked
    // to the peer's key + minted from a mint they accept; offline fallback is
    // bearer from a shared mint. `allowedMints` constrains the source mint.
    void machine
      .startSendEcash({
        reset: true,
        ...(plan.mode === 'lock'
          ? { p2pkLockPubkey: plan.lockPubkey, recipientPubkey: plan.recipientPubkey }
          : {}),
        ...(plan.allowedMints ? { allowedMints: plan.allowedMints } : {}),
        recipientProfile: { displayName, avatarUrl: null, nip05: null },
      })
      .catch((err) => {
        clearOwnSession();
        paymentLog.error('near_pay.peer.list_start_send_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
  };

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
        Keep the app open and nearby BitChat users will appear here.
      </Text>
    </VStack>
  );

  return (
    <View style={rootStyle}>
      <Stack.Screen options={STACK_OPTIONS} />
      <View style={contentStyle}>
        <HStack align="center" gap={8} style={summaryStyle}>
          <Icon name="mdi:bluetooth" size={18} color={BLUETOOTH_ACCENT} />
          <Text size={13} style={summaryTextStyle}>
            {subtitleText}
          </Text>
        </HStack>
        <List
          data={sortedPeers}
          keyExtractor={peerKeyExtractor}
          renderItem={renderItem}
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
