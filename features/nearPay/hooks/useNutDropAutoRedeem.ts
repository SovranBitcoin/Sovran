import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import {
  addBLEMessageListener,
  beginBLEBackgroundTask,
  endBLEBackgroundTask,
} from 'bitchat-module';
import { classifyMeshToken, meshTokenDedupeKey } from '@sovranbitcoin/colada';

import { startMeshNutDrop, stopMeshNutDrop } from '@/features/nearPay/lib/meshNutDrop';
import { drainNutDropRedeemQueue } from '@/features/nearPay/lib/nutDropAutoRedeem';
import { deriveBitchatBLEIdentityMaterial } from '@/features/bitchat/lib/bleIdentity';
import { paymentLog } from '@/shared/lib/logger';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';
import { extractCashuToken } from '@/shared/ui/composed/chat/extractCashuToken';

/**
 * App-wide Nut Drop receive pipeline. Mounted in BitchatBLEProvider (inside
 * AccountScopedProviders, so it remounts per profile and always answers
 * solicits with the ACTIVE profile's lock key).
 *
 * Two inbound paths feed the same persisted redeem queue:
 * - In-band NUT-18 payments (capable peers): colada's responder answers
 *   solicits with single-use payment requests and the intake validates +
 *   enqueues payments (`startMeshNutDrop`).
 * - Public-broadcast tokens (legacy + vanilla ladder): every public mesh
 *   message is classified — locked to my key → enqueue; locked to someone
 *   else (incl. our own broadcast echo) → silent; bearer → left to the chat
 *   surface's manual tap-to-redeem.
 *
 * Drain triggers: payment/message arrival, app foreground, offline→online,
 * and profile mount (manager init catches entries queued while dead).
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
    if (!myPubkey33 || !keys) return;

    startMeshNutDrop({
      p2pkReceiveKey: myPubkey33,
      getIdentityMaterial: () =>
        deriveBitchatBLEIdentityMaterial({ privateKey: keys.privateKey, pubkey: keys.pubkey }),
      onPaymentAccepted: () => void drainWithBackgroundBudget(),
    });

    paymentLog.info('near_pay.redeem.listener_mounted');
    const subscription = addBLEMessageListener((event) => {
      if (event.isPrivate) return;
      const token = extractCashuToken(event.content);
      if (!token) return;

      const classified = classifyMeshToken(token, myPubkey33);
      if (classified.classification !== 'locked-to-me') {
        if (classified.classification === 'locked-to-other') {
          paymentLog.debug('near_pay.redeem.ignored_locked_to_other');
        }
        return;
      }
      if (!classified.mintUrl) return;

      const enqueued = useNutDropRedeemQueueStore.getState().enqueue(meshTokenDedupeKey(token), {
        token,
        mintUrl: classified.mintUrl,
        amount: classified.amount,
        unit: classified.unit ?? 'sat',
        senderPeerID: event.senderPeerID,
      });
      paymentLog.info('near_pay.redeem.locked_token_received', {
        amount: classified.amount,
        mintUrl: classified.mintUrl,
        enqueued,
        senderPeerID: event.senderPeerID,
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
      stopMeshNutDrop();
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
