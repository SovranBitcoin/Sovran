/**
 * @fileoverview Which redeem-queue entries are message ecash, and in what state.
 *
 * Pure reads over the queue's stored map. No wallet, no network: the review
 * list and the design system render from these without loading either.
 */

import type { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';

export interface ParkedMessageEcash {
  tokenHash: string;
  token: string;
  mintUrl: string;
  amount: number;
  unit: string;
  reason: 'untrusted-mint' | 'failed';
}

type QueueEntries = ReturnType<typeof useNutDropRedeemQueueStore.getState>['byTokenHash'];

/** Nostr-delivered entries the orchestrator will not touch again on its own. */
export function parkedMessageEcash(entries: QueueEntries): ParkedMessageEcash[] {
  const parked: ParkedMessageEcash[] = [];
  for (const [tokenHash, entry] of Object.entries(entries)) {
    if (entry.source !== 'nostr') continue;
    if (entry.status !== 'untrusted-mint' && entry.status !== 'failed') continue;
    parked.push({
      tokenHash,
      token: entry.token,
      mintUrl: entry.mintUrl,
      amount: entry.amount,
      unit: entry.unit,
      reason: entry.status,
    });
  }
  return parked;
}

/** Nostr-delivered entries the orchestrator still has work to do on. */
export function hasDrainableMessageEcash(entries: QueueEntries): boolean {
  return Object.values(entries).some(
    (entry) =>
      entry.source === 'nostr' && (entry.status === 'pending' || entry.status === 'redeeming')
  );
}

/**
 * When the next backed-off retry of a message token falls due, or `null` when
 * none is waiting on a timer. The orchestrator records the time but does not
 * wake itself for it.
 */
export function nextMessageEcashRetryAt(entries: QueueEntries): number | null {
  let soonest: number | null = null;
  for (const entry of Object.values(entries)) {
    if (entry.source !== 'nostr' || entry.status !== 'pending' || entry.nextAttemptAt <= 0)
      continue;
    if (soonest === null || entry.nextAttemptAt < soonest) soonest = entry.nextAttemptAt;
  }
  return soonest;
}

/** True when a message token is waiting and its time to be tried has come. */
export function hasDueMessageEcash(entries: QueueEntries, now: number): boolean {
  return Object.values(entries).some(
    (entry) => entry.source === 'nostr' && entry.status === 'pending' && entry.nextAttemptAt <= now
  );
}
