import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import {
  addBLEPrivateMessageListener,
  beginBLEBackgroundTask,
  endBLEBackgroundTask,
} from 'bitchat-module';
import { classifyMeshToken, meshTokenDedupeKey } from '@sovranbitcoin/colada';

import { drainNutDropRedeemQueue } from '@/features/nearPay/lib/nutDropAutoRedeem';
import { paymentLog } from '@/shared/lib/logger';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';
import { extractCashuToken } from '@/shared/ui/composed/chat/extractCashuToken';

/**
 * App-wide Nut Drop receive pipeline. Mounted in BitchatBLEProvider (inside
 * AccountScopedProviders, so it remounts per profile and classifies against
 * the ACTIVE profile's P2PK key).
 *
 * Every Nut Drop token arrives as a private Noise DM (encrypted to us). Each
 * DM is classified against my key: locked-to-me OR bearer → enqueue for
 * auto-redeem (a DM is addressed to us, so a bearer token in it is ours);
 * locked-to-other → ignore (shouldn't reach us in a DM).
 *
 * Drain triggers: message arrival, app foreground, offline→online, and
 * profile mount (manager init catches entries queued while dead).
 */
/**
 * Drain wrapped in an iOS background-task assertion when the app is
 * backgrounded — a BLE wake gives only ~10s by default, not enough for the
 * mint swap. Android no-ops (handle -1): the mesh foreground service already
 * keeps the process alive. The token is persisted BEFORE the drain, so an
 * expired budget only delays redemption to the next foreground drain.
 */
async function drainWithBackgroundBudget(): Promise<void> {
  if (AppState.currentState === 'active') {
    return drainNutDropRedeemQueue();
  }
  const handle = await beginBLEBackgroundTask('nutdrop-redeem');
  try {
    await drainNutDropRedeemQueue();
  } finally {
    void endBLEBackgroundTask(handle);
  }
}

export function useNutDropAutoRedeem(): void {
  const { keys } = useNostrKeysContext();
  const { isOffline } = useOfflineStatus();
  const myPubkey33 = keys ? `02${keys.pubkey}` : null;
  const wasOffline = useRef(isOffline);

  useEffect(() => {
    if (!myPubkey33 || !keys) {
      paymentLog.info('near_pay.mesh.runtime_skipped', { hasKeys: !!keys });
      return;
    }

    paymentLog.info('near_pay.redeem.listener_mounted');
    const subscription = addBLEPrivateMessageListener((event) => {
      if (event.isOwn) return;
      const token = extractCashuToken(event.content);
      if (!token) return;

      const classified = classifyMeshToken(token, myPubkey33);
      // A private DM is addressed to us, so redeem locked-to-me OR bearer; only
      // ignore a token locked to a different key (shouldn't reach us in a DM).
      if (classified.classification === 'locked-to-other') {
        paymentLog.debug('near_pay.redeem.ignored_locked_to_other');
        return;
      }
      if (!classified.mintUrl) return;

      const enqueued = useNutDropRedeemQueueStore.getState().enqueue(meshTokenDedupeKey(token), {
        token,
        mintUrl: classified.mintUrl,
        amount: classified.amount,
        unit: classified.unit ?? 'sat',
        senderPeerID: event.peerID,
      });
      paymentLog.info('near_pay.redeem.token_received', {
        classification: classified.classification,
        amount: classified.amount,
        mintUrl: classified.mintUrl,
        enqueued,
        senderPeerID: event.peerID,
      });
      void drainWithBackgroundBudget();
    });

    // Mount-time drain: catches entries persisted while the app was dead or
    // the previous drain was interrupted mid-flight.
    void drainNutDropRedeemQueue();

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void drainNutDropRedeemQueue();
    });

    return () => {
      subscription.remove();
      appStateSub.remove();
    };
  }, [keys, myPubkey33]);

  // Offline → online: retry anything parked on mint unreachability.
  useEffect(() => {
    if (wasOffline.current && !isOffline) {
      void drainNutDropRedeemQueue();
    }
    wasOffline.current = isOffline;
  }, [isOffline]);
}
