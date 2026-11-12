/**
 * @fileoverview Which redeem-queue entries are message ecash, and in what state.
 *
 * Pure reads over the queue's stored map. No wallet, no network: the review
 * list and the design system render from these without loading either.
 */

import {
  isMeshRedeemDue,
  isMeshRedeemInPlay,
  isMeshRedeemSettled,
  meshRedeemPhase,
  type MeshRedeemPhase,
} from 'wallet/redeemEntry';

import type { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';

export interface ParkedMessageEcash {
  tokenHash: string;
  token: string;
  mintUrl: string;
  amount: number;
  unit: string;
  reason: HeldPhase['kind'];
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

/** Held for the person: the orchestrator will not touch it again on its own. */
type HeldPhase = Extract<MeshRedeemPhase, { kind: 'untrusted-mint' | 'failed' }>;

function isHeld(phase: MeshRedeemPhase): phase is HeldPhase {
  return phase.kind === 'untrusted-mint' || phase.kind === 'failed';
}

/** Nostr-delivered entries the orchestrator will not touch again on its own. */
export function parkedMessageEcash(entries: QueueEntries): ParkedMessageEcash[] {
  const parked: ParkedMessageEcash[] = [];
  for (const [tokenHash, entry] of Object.entries(entries)) {
    if (entry.source !== 'nostr') continue;
    const phase = meshRedeemPhase(entry);
    if (!isHeld(phase)) continue;
    parked.push({
      tokenHash,
      token: entry.token,
      mintUrl: entry.mintUrl,
      amount: entry.amount,
      unit: entry.unit,
      reason: phase.kind,
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
    const phase = meshRedeemPhase(entry);
    if (isMeshRedeemSettled(phase)) continue;
    unclaimed.push({
      tokenHash,
      token: entry.token,
      mintUrl: entry.mintUrl,
      amount: entry.amount,
      unit: entry.unit,
      receivedAt: entry.receivedAt,
      state: isHeld(phase) ? phase.kind : 'receiving',
    });
  }
  return unclaimed.sort((a, b) => b.receivedAt - a.receivedAt);
}

/** Nostr-delivered entries the orchestrator still has work to do on. */
export function hasDrainableMessageEcash(entries: QueueEntries): boolean {
  return Object.values(entries).some(
    (entry) => entry.source === 'nostr' && isMeshRedeemInPlay(meshRedeemPhase(entry))
  );
}

/**
 * When the next backed-off retry of a message token falls due, or `null` when
 * none is waiting on a timer. A receive cut short waits for its retry time as
 * a waiting token does. The orchestrator records the time but does not wake
 * itself for it.
 */
export function nextMessageEcashRetryAt(entries: QueueEntries): number | null {
  let soonest: number | null = null;
  for (const entry of Object.values(entries)) {
    if (entry.source !== 'nostr') continue;
    const phase = meshRedeemPhase(entry);
    if (!isMeshRedeemInPlay(phase) || phase.retryAt === null) continue;
    if (soonest === null || phase.retryAt < soonest) soonest = phase.retryAt;
  }
  return soonest;
}

/** True when a message token's time to be tried has come (see `isMeshRedeemDue`). */
export function hasDueMessageEcash(entries: QueueEntries, now: number): boolean {
  return Object.values(entries).some(
    (entry) => entry.source === 'nostr' && isMeshRedeemDue(meshRedeemPhase(entry), now)
  );
}
