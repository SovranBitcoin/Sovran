/**
 * A transaction's spending conditions, with the one thing the pure model
 * cannot know: which keys this wallet can sign for.
 */

import { useMemo } from 'react';

import { useOurP2pkPubkeys } from '@/shared/hooks/useOurP2pkPubkeys';
import { describeSendLock, type SpendingConditions } from 'wallet';

/** Anything `describeSendLock` can read: a token's proofs and/or metadata. */
type LockBearingEntry = Parameters<typeof describeSendLock>[0];

export function useSpendingConditions(
  entry: LockBearingEntry | null | undefined
): SpendingConditions | null {
  const ourPubkeys = useOurP2pkPubkeys();
  return useMemo(() => {
    if (!entry) return null;
    return describeSendLock(entry, {
      now: Date.now(),
      ...(ourPubkeys ? { ourPubkeys } : {}),
    });
  }, [entry, ourPubkeys]);
}
