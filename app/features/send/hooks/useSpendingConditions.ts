/**
 * A transaction's spending conditions, with the one thing the pure model
 * cannot know: which keys this wallet can sign for.
 */

import { useMemo } from 'react';

import { useOurP2pkPubkeys } from '@/shared/hooks/useOurP2pkPubkeys';
import { useBoundaryClock } from '@/shared/hooks/useBoundaryClock';
import { describeSendLock, LOCK_CLOCK_SKEW_MS, type SpendingConditions } from 'wallet';

/** Anything `describeSendLock` can read: a token's proofs and/or metadata. */
type LockBearingEntry = Parameters<typeof describeSendLock>[0];

export function useSpendingConditions(
  entry: LockBearingEntry | null | undefined
): SpendingConditions | null {
  const ourPubkeys = useOurP2pkPubkeys();
  const unlockAt = useMemo(
    () => (entry ? describeSendLock(entry, { now: 0 })?.unlockAt : null),
    [entry]
  );
  const lockClock = useBoundaryClock(unlockAt);
  const reclaimClock = useBoundaryClock(unlockAt == null ? null : unlockAt + LOCK_CLOCK_SKEW_MS);
  return useMemo(() => {
    if (!entry) return null;
    return describeSendLock(entry, {
      now: Math.max(lockClock, reclaimClock),
      ...(ourPubkeys ? { ourPubkeys } : {}),
    });
  }, [entry, ourPubkeys, lockClock, reclaimClock]);
}
