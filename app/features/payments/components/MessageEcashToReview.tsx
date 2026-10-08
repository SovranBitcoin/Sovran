/**
 * @fileoverview Message ecash the wallet could not add by itself.
 *
 * Ecash sent by Nostr message is redeemed in the background. Two cases need a
 * person: the token's mint is not one this wallet trusts, or redeeming kept
 * failing. Each such token is one row here; the row opens the ordinary receive
 * screen, where the mint can be reviewed and the token redeemed. Renders
 * nothing when there is nothing to review.
 */

import { useCallback, useMemo } from 'react';
import { useFocusEffect } from 'expo-router';

import { drainNutDropRedeemQueue } from '@/features/nearPay/lib/nutDropAutoRedeem';
import { guardedRouter } from '@/shared/hooks/useGuardedRouter';
import { buildReceiveHistoryEntry } from '@/shared/lib/cashu/utils';
import { paymentLog, redactError } from '@/shared/lib/logger';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';

import { markMessageEcashReviewed, reconcileParkedMessageEcash } from '../lib/dmEcashRecovery';
import { parkedMessageEcash, type ParkedMessageEcash } from '../lib/parkedMessageEcash';

import { MessageEcashReviewList } from './MessageEcashReviewList';

function open(ownerPubkey: string, entry: ParkedMessageEcash) {
  try {
    markMessageEcashReviewed(ownerPubkey, entry.tokenHash);
    guardedRouter.navigate({
      pathname: '/(receive-flow)/receiveToken',
      params: {
        receiveHistoryEntry: JSON.stringify(buildReceiveHistoryEntry(entry.token, entry.unit)),
      },
    });
  } catch (error) {
    paymentLog.warn('payment.dm_ecash.review_open_failed', { error: redactError(error) });
  }
}

export function MessageEcashToReview() {
  // Select the stored map and derive from it: deriving inside the selector
  // returns new objects on every read, which the store treats as a change.
  const entries = useNutDropRedeemQueueStore((state) => state.byTokenHash);
  const parked = useMemo(() => parkedMessageEcash(entries), [entries]);
  const pubkey = useNostrKeysContext().keys?.pubkey;
  const hasParked = parked.length > 0;

  // Coming back from the receive screen is a focus, not an app-state change:
  // this is where a token redeemed by hand, or a mint just added, is noticed.
  useFocusEffect(
    useCallback(() => {
      if (!hasParked || !pubkey) return;
      // Cleared on blur and on an account change, which re-creates this effect.
      let focused = true;
      void reconcileParkedMessageEcash(pubkey, () => focused)
        .then((requeued) => (requeued && focused ? drainNutDropRedeemQueue() : undefined))
        .catch((error: unknown) => {
          paymentLog.warn('payment.dm_ecash.reconcile_failed', { error: redactError(error) });
        });
      return () => {
        focused = false;
      };
    }, [hasParked, pubkey])
  );

  if (!pubkey) return null;
  return <MessageEcashReviewList entries={parked} onOpen={(entry) => open(pubkey, entry)} />;
}
