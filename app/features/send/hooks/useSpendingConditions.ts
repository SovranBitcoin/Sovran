/**
 * A transaction's spending conditions, with the one thing the pure model
 * cannot know: which keys this wallet can sign for.
 *
 * Only public keys leave the keyring here. "Can I take this back?" is answered
 * by comparing pubkeys; the private half never needs to be in app memory to
 * answer it.
 */

import { useManagerContext } from '@cashu/coco-react';
import { resolveReceiveP2PKPublicKeys } from '@sovranbitcoin/coco-cashu-plugin-p2pk-import';
import { useEffect, useMemo, useState } from 'react';

import { paymentLog } from '@/shared/lib/logger';
import { describeSendLock, type SpendingConditions } from 'wallet';

/** Anything `describeSendLock` can read: a token's proofs and/or metadata. */
type LockBearingEntry = Parameters<typeof describeSendLock>[0];

export function useSpendingConditions(
  entry: LockBearingEntry | null | undefined
): SpendingConditions | null {
  // Not `useManager()`: that throws when the manager is not ready, and this
  // screen renders from a route param — including on a cold open, before the
  // wallet has finished coming up. Conditions read from the token's own proofs
  // do not need a manager at all; only "is that key ours" does.
  const { manager } = useManagerContext();
  const [ourPubkeys, setOurPubkeys] = useState<readonly string[] | undefined>(undefined);

  useEffect(() => {
    if (!manager) return;
    let cancelled = false;
    void resolveReceiveP2PKPublicKeys(manager)
      .then((keys) => {
        if (!cancelled) setOurPubkeys(keys);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Leaving them undefined is not the same as "we hold none": the model
        // reports an unknown reclaim verdict rather than claiming we cannot.
        paymentLog.warn('send.conditions.keysUnavailable', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [manager]);

  return useMemo(() => {
    if (!entry) return null;
    return describeSendLock(entry, {
      now: Date.now(),
      ...(ourPubkeys ? { ourPubkeys } : {}),
    });
  }, [entry, ourPubkeys]);
}
