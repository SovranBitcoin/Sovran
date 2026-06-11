import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import {
  addBLEMessageListener,
  beginBLEBackgroundTask,
  endBLEBackgroundTask,
} from 'bitchat-module';

import { drainNutDropRedeemQueue } from '@/features/nearPay/lib/nutDropAutoRedeem';
import { classifyToken, tokenDedupeKey } from '@/features/nearPay/lib/nutDropTokens';
import { paymentLog } from '@/shared/lib/logger';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';
import { extractCashuToken } from '@/shared/ui/composed/chat/extractCashuToken';

/**
 * App-wide Nut Drop auto-redeem pipeline. Mounted in BitchatBLEProvider
 * (inside AccountScopedProviders, so it remounts per profile and always
 * classifies against the ACTIVE profile's lock key).
 *
 * Every public BLE mesh message is checked for a cashu token:
 * - locked to my key  → persist into the redeem queue, then drain.
 * - locked to someone else → silent ignore. This also covers the sender
 *   seeing its own broadcast echo (the lock is the recipient's key).
 * - bearer (vanilla bitchat sender) → untouched; the chat surface keeps
 *   today's manual CashuTokenBubble tap-to-redeem.
 *
 * Drain triggers beyond message arrival: app returning to foreground,
 * offline→online transitions, and profile mount (manager init catches
 * entries queued while the app was dead).
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
    if (!myPubkey33) return;

    paymentLog.info('near_pay.redeem.listener_mounted');
    const subscription = addBLEMessageListener((event) => {
      if (event.isPrivate) return;
      const token = extractCashuToken(event.content);
      if (!token) return;

      const classified = classifyToken(token, myPubkey33);
      if (classified.classification !== 'locked-to-me') {
        if (classified.classification === 'locked-to-other') {
          paymentLog.debug('near_pay.redeem.ignored_locked_to_other');
        }
        return;
      }
      if (!classified.mintUrl) return;

      const enqueued = useNutDropRedeemQueueStore.getState().enqueue(tokenDedupeKey(token), {
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
    };
  }, [myPubkey33]);

  // Offline → online: retry anything parked on mint unreachability.
  useEffect(() => {
    if (wasOffline.current && !isOffline) {
      void drainNutDropRedeemQueue();
    }
    wasOffline.current = isOffline;
  }, [isOffline]);
}
