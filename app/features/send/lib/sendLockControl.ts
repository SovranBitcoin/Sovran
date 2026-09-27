/**
 * What the amount screen's lock control is, for the payment in front of it.
 *
 * Every ecash amount screen shows the lock in its header, and every locked
 * send asks the same two things before it leaves: who it is locked to, and for
 * how long. What differs between flows is only who owns the choice:
 *
 *   - `optional`    — a send to a person. Locking is the sender's to turn on
 *                     or off.
 *   - `required`    — the flow arrived locked (a Nut Drop, a scanned wallet
 *                     receive key). The lock stands; the sender still chooses
 *                     how long, and is asked before the send leaves.
 *   - `request`     — a payment request. Its NUT-10 option dictates the whole
 *                     secret, so there is nothing here to choose.
 *   - `unavailable` — locking would fail or has nobody to lock to.
 *   - `hidden`      — not an ecash payment (a melt, a mint quote).
 *
 * Pure: no hooks, no I/O, so every branch is a unit test.
 */

import type { P2pkLockSpec } from 'wallet';

import type { CashuP2pkPubkey } from '@/shared/lib/protocolIds';

import { REASON_NO_RECIPIENT, type SendLockGate } from './sendLockGate';
import { lockUntilSec, SEND_LOCK_DURATIONS, type SendLockDurationOption } from './sendLockMenu';

export const REASON_REQUEST_SETS_LOCK =
  'This payment request asks for ecash locked to its own key, so the request sets the terms.';
export const REASON_REQUEST_UNLOCKED =
  'This payment request asks for unlocked ecash, so it cannot be locked here.';

export type SendLockMode =
  | { mode: 'hidden' }
  | { mode: 'request'; locked: boolean; reason: string }
  | { mode: 'required'; lockKey: string }
  | { mode: 'optional'; lockKey: CashuP2pkPubkey; confirmed: boolean }
  | { mode: 'unavailable'; reason: string; hasRecipient: boolean };

interface SendLockModeInput {
  destination?: string;
  /** The key the flow arrived locked to, if it did. */
  seededLockKey: string | null;
  /** The NUT-10 P2PK key of a payment request being paid, if it has one. */
  requestLockKey: string | null;
  recipientPubkey?: string;
  gate: SendLockGate;
}

export function deriveSendLockMode(input: SendLockModeInput): SendLockMode {
  const { destination, seededLockKey, requestLockKey, recipientPubkey, gate } = input;

  if (destination === 'paymentRequest') {
    return requestLockKey
      ? { mode: 'request', locked: true, reason: REASON_REQUEST_SETS_LOCK }
      : { mode: 'request', locked: false, reason: REASON_REQUEST_UNLOCKED };
  }
  if (destination !== 'sendEcash') return { mode: 'hidden' };

  if (seededLockKey) return { mode: 'required', lockKey: seededLockKey };

  if (!recipientPubkey) {
    return { mode: 'unavailable', reason: REASON_NO_RECIPIENT, hasRecipient: false };
  }
  if (gate.kind === 'unavailable') {
    return { mode: 'unavailable', reason: gate.reason, hasRecipient: true };
  }
  return { mode: 'optional', lockKey: gate.lockKey, confirmed: gate.kind === 'ready' };
}

/** What the sender chose in the lock sheet, kept until the send leaves. */
interface SendLockChoice {
  lockKey: string;
  durationId: string;
  refundKey?: string;
}

function lockDurationOption(durationId: string): SendLockDurationOption | null {
  return SEND_LOCK_DURATIONS.find((option) => option.id === durationId) ?? null;
}

/**
 * The NUT-11 terms for a choice, as of `nowMs`.
 *
 * The unlock time is worked out when the send leaves, not when the sheet was
 * answered: "reclaim after 1 hour" chosen ten minutes before pressing Next
 * must still mean an hour from the send. Returns null for a choice that
 * cannot be honoured — a timed lock with no refund key would open to whoever
 * holds the token, so it is refused rather than sent without its way back.
 */
export function lockSpecForChoice(choice: SendLockChoice, nowMs: number): P2pkLockSpec | null {
  const option = lockDurationOption(choice.durationId);
  if (!option || option.id === 'off') return null;
  const locktimeSec = lockUntilSec(option, nowMs);
  if (locktimeSec === null) return { pubkey: choice.lockKey };
  if (!choice.refundKey) return null;
  return { pubkey: choice.lockKey, locktimeSec, refundKeys: [choice.refundKey] };
}

/** Whether a kept choice still belongs to the payment on screen. */
export function choiceMatchesMode(choice: SendLockChoice | null, mode: SendLockMode): boolean {
  if (!choice) return false;
  if (mode.mode !== 'optional' && mode.mode !== 'required') return false;
  return choice.lockKey.toLowerCase() === mode.lockKey.toLowerCase();
}
