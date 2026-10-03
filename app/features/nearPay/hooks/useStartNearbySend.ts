import { usePaymentFlowMachine } from 'wallet/react';
import { accountMintUrls, toRealUnit } from 'wallet';
import type { BLEPeer } from 'bitchat-module';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNearPaySessionStore } from '@/shared/stores/runtime/nearPayStore';
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';
import { readProfileRecord } from '@/shared/lib/nostr/useEntityCache';
import { paymentLog } from '@/shared/lib/logger';
import { peerDisplayName } from '../lib/peerProfile';
import { planNearPaySend } from '../lib/nearPaySendDecision';
import {
  notifyNoSharedMint,
  notifyNutDropNeedsBitcoinAccount,
  notifyNutDropPeerNotReady,
  notifyNearbyNeedsConnection,
} from '../lib/startNearPaySend';

/** Destination-first entry shared by Send and the nearby list. */
export function useStartNearbySend() {
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext, unit: 'sat' });
  const { isOffline } = useOfflineStatus();
  return async (peer: BLEPeer, beforeStart?: () => void) => {
    if (toRealUnit(useMintStore.getState().activeUnit) !== 'sat')
      return notifyNutDropNeedsBitcoinAccount();
    const plan = planNearPaySend({ peer, ourMints: accountMintUrls(walletContext), isOffline });
    const name = peerDisplayName(peer);
    if (plan.mode === 'block') {
      if (plan.reason === 'offline') return notifyNearbyNeedsConnection();
      if (plan.reason === 'no-shared-mint') return notifyNoSharedMint(name);
      return notifyNutDropPeerNotReady(name);
    }
    const profile = readProfileRecord(plan.recipientPubkey);
    clearPaymentContext('send.near_pay');
    useNearPaySessionStore.getState().start(
      {
        peerID: peer.peerID,
        nickname: name,
        hasDirectLink: peer.hasDirectLink,
        lastSeen: peer.lastSeen,
        creq: peer.creq,
        nostrPubkeyHex: plan.recipientPubkey,
        walletCapabilityExpiresAt: peer.walletCapabilityExpiresAt,
        delivery: { locked: true },
      },
      'route'
    );
    const sessionID = useNearPaySessionStore.getState().active?.id;
    beforeStart?.();
    try {
      await machine.startSendEcash({
        reset: true,
        p2pkLockPubkey: plan.lockPubkey,
        recipientPubkey: plan.recipientPubkey,
        allowedMints: plan.allowedMints,
        recipientProfile: { displayName: name, avatarUrl: profile?.picture ?? null, nip05: null },
      });
    } catch (error) {
      if (useNearPaySessionStore.getState().active?.id === sessionID)
        useNearPaySessionStore.getState().clear();
      paymentLog.error('near_pay.peer.start_send_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
