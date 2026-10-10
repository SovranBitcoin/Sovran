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
  receivedAt: number;
}

/** Message ecash that is not in the wallet yet: held, or on its way in. */
export interface UnclaimedMessageEcash extends Omit<ParkedMessageEcash, 'reason'> {
  state: ParkedMessageEcash['reason'] | 'receiving';
}

/** One mint's held tokens in one unit: what a single "Receive all" covers. */
export interface ParkedMintGroup {
  key: string;
  mintUrl: string;
  unit: string;
  total: number;
  count: number;
  /** True when the wallet does not trust this mint yet. */
  unknownMint: boolean;
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
      receivedAt: entry.receivedAt,
    });
  }
  return parked;
}

/**
 * Held tokens gathered by mint and unit, in the order each mint first appears.
 * A total is only meaningful within one unit, so a mint holding two units is
 * two groups.
 */
export function parkedMintGroups(parked: readonly ParkedMessageEcash[]): ParkedMintGroup[] {
  const groups = new Map<string, ParkedMintGroup>();
  for (const entry of parked) {
    const key = `${entry.mintUrl}|${entry.unit}`;
    const group = groups.get(key) ?? {
      key,
      mintUrl: entry.mintUrl,
      unit: entry.unit,
      total: 0,
      count: 0,
      unknownMint: false,
    };
    group.total += entry.amount;
    group.count += 1;
    if (entry.reason === 'untrusted-mint') group.unknownMint = true;
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * Every message token of one mint and unit that has not reached the wallet,
 * newest first. Tokens being received stay listed, so a batch does not empty
 * the page while it runs.
 */
export function unclaimedMessageEcash(
  entries: QueueEntries,
  mintUrl: string,
  unit: string
): UnclaimedMessageEcash[] {
  const unclaimed: UnclaimedMessageEcash[] = [];
  for (const [tokenHash, entry] of Object.entries(entries)) {
    if (entry.source !== 'nostr' || entry.mintUrl !== mintUrl || entry.unit !== unit) continue;
    if (entry.status === 'redeemed' || entry.status === 'spent') continue;
    unclaimed.push({
      tokenHash,
      token: entry.token,
      mintUrl: entry.mintUrl,
      amount: entry.amount,
      unit: entry.unit,
      receivedAt: entry.receivedAt,
      state:
        entry.status === 'untrusted-mint' || entry.status === 'failed' ? entry.status : 'receiving',
    });
  }
  return unclaimed.sort((a, b) => b.receivedAt - a.receivedAt);
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
