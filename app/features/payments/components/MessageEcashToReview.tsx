/**
 * @fileoverview Message ecash the wallet could not add by itself.
 *
 * Ecash sent by Nostr message is redeemed in the background. Two cases need a
 * person: the token's mint is not one this wallet trusts, or redeeming kept
 * failing. Such tokens are gathered by mint; each mint is one row here, and
 * the row opens that mint's page, where they can be taken together. Renders
 * nothing when there is nothing to review.
 */

import { useCallback, useMemo } from 'react';
import { useFocusEffect } from 'expo-router';

import { drainNutDropRedeemQueue } from '@/features/nearPay/lib/nutDropAutoRedeem';
import { guardedRouter } from '@/shared/hooks/useGuardedRouter';
import { paymentLog, redactError } from '@/shared/lib/logger';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';

import { reconcileParkedMessageEcash } from '../lib/dmEcashRecovery';
import {
  parkedMessageEcash,
  parkedMintGroups,
  type ParkedMintGroup,
} from '../lib/parkedMessageEcash';

import { MessageEcashReviewList } from './MessageEcashReviewList';

function open(group: ParkedMintGroup) {
  guardedRouter.navigate({
    pathname: '/(receive-flow)/messageEcash',
    params: { mintUrl: group.mintUrl, unit: group.unit },
  });
}

export function MessageEcashToReview() {
  // Select the stored map and derive from it: deriving inside the selector
  // returns new objects on every read, which the store treats as a change.
  const entries = useNutDropRedeemQueueStore((state) => state.byTokenHash);
  const groups = useMemo(() => parkedMintGroups(parkedMessageEcash(entries)), [entries]);
  const pubkey = useNostrKeysContext().keys?.pubkey;
  const hasParked = groups.length > 0;

  // Coming back from a mint's page is a focus, not an app-state change:
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
  return <MessageEcashReviewList groups={groups} onOpen={open} />;
}
