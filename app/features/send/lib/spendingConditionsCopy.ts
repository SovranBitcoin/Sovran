/**
 * What to say about a token's spending conditions.
 *
 * The wallet package owns the model — which keys, which locktime, which
 * path is open — and this owns the words. Every sentence here is a claim
 * about somebody's money, so each one maps to exactly one state of that
 * model and says only what it establishes:
 *
 *   - a permanent lock cannot be taken back, ever;
 *   - a locktime WITH a refund tag can, from a date, and the recipient can
 *     still claim in the meantime — whoever spends first wins;
 *   - a locktime WITHOUT one becomes claimable by anyone holding the token,
 *     which is not something we create but is something we can be shown.
 *
 * Pure. No React, no formatting of dates (the caller's locale decides that).
 */

import type { SpendingConditions } from 'wallet';

type SpendingConditionsTone = 'neutral' | 'accent' | 'warning' | 'danger';

interface SpendingConditionsCopy {
  tone: SpendingConditionsTone;
  title: string;
  /** Sentences, rendered as one paragraph. */
  body: string[];
  /** A date the caller formats and substitutes into `{date}`. */
  dateMs?: number;
}

interface SpendingConditionsCopyInput {
  conditions: SpendingConditions;
  /** Display name for the lock's holder; falls back to a truncated key. */
  recipientName: string | null;
  /** False when the lock key was our assumption rather than their claim. */
  confirmedRecipient?: boolean;
}

const UNCONFIRMED = (name: string) =>
  `This uses ${name}’s Nostr identity key. Redeeming needs a wallet that can sign with that key.`;

export function describeSpendingConditionsCopy(
  input: SpendingConditionsCopyInput
): SpendingConditionsCopy | null {
  const { conditions, recipientName, confirmedRecipient = true } = input;
  if (conditions.kind === 'unlocked') return null;

  const who = recipientName ?? 'the holder of that key';
  const caveat = confirmedRecipient ? [] : [UNCONFIRMED(who)];

  if (conditions.kind === 'htlc') {
    return {
      tone: 'neutral',
      title: 'Hash-locked',
      body: ['Redeeming this needs a secret preimage, not a key.'],
    };
  }

  if (conditions.kind === 'unknown') {
    return {
      tone: 'neutral',
      title: 'Unknown spending conditions',
      body: [
        'This token carries conditions this wallet does not understand.',
        'This wallet cannot redeem it.',
      ],
    };
  }

  if (conditions.mixed) {
    return {
      tone: 'warning',
      title: 'Mixed spending conditions',
      body: [
        `${conditions.lockedProofCount} of ${conditions.proofCount} parts of this token are locked, and not all the same way.`,
        'The details show the first locked part. Its keys do not describe every part of this token.',
      ],
    };
  }

  if ((conditions.main?.requiredSignatures ?? 1) > 1 && conditions.phase !== 'timed-expired') {
    const total = conditions.main?.pubkeys.length ?? 0;
    return {
      tone: 'warning',
      title: `Needs ${conditions.main?.requiredSignatures ?? 2} of ${total} signatures`,
      body: [
        'This token needs more than one signature to redeem.',
        'This wallet can only produce one, so it cannot redeem it.',
      ],
    };
  }

  const sigAll = conditions.limits.includes('sig-all')
    ? ['Their wallet must sign the whole transaction (SIG_ALL); not every wallet can.']
    : [];

  if ((conditions.main?.ourKeys ?? 0) > 0 && conditions.phase !== 'timed-expired') {
    return {
      tone: 'accent',
      title: 'Locked to you',
      body: conditions.limits.includes('sig-all')
        ? [
            'This wallet holds a matching key, but cannot sign the required whole transaction (SIG_ALL).',
          ]
        : ['This wallet has a key that can redeem it.'],
    };
  }

  if (conditions.phase === 'permanent') {
    return {
      tone: 'accent',
      title: `Locked to ${who}`,
      body: [
        'Only they can redeem this.',
        'There is no expiry, so you cannot take it back.',
        ...sigAll,
        ...caveat,
      ],
    };
  }

  const unlockAt = conditions.unlockAt ?? undefined;
  const hasRefund = conditions.refund !== null;
  const expired = conditions.phase === 'timed-expired';
  const reclaim = conditions.reclaim;
  const refundCopy =
    reclaim.kind === 'now'
      ? 'You can also take it back now — whoever spends first wins.'
      : reclaim.kind === 'at'
        ? expired
          ? 'Reclaim will be available shortly, allowing for the mint’s clock.'
          : 'After that you can take it back.'
        : 'Reclaim requires the listed refund keys and signature threshold.';

  if (!hasRefund) {
    // We never create this shape. A scanned or foreign token can be it, and
    // saying so plainly is the whole point of showing conditions at all.
    return expired
      ? {
          tone: 'danger',
          title: 'Anyone can redeem this now',
          body: [
            'The lock has expired and this is plain bearer ecash again.',
            'Take it back now if they never claimed it.',
          ],
          ...(unlockAt ? { dateMs: unlockAt } : {}),
        }
      : {
          tone: 'warning',
          title: `Locked to ${who} until {date}`,
          body: [
            'Only they can redeem it before {date}.',
            'After that, anyone holding the token can redeem it — including someone who only saw a screenshot.',
            ...sigAll,
            ...caveat,
          ],
          ...(unlockAt ? { dateMs: unlockAt } : {}),
        };
  }

  return expired
    ? {
        tone: 'warning',
        title: 'The lock has expired',
        body: ['They can still redeem it.', refundCopy],
        ...(unlockAt ? { dateMs: unlockAt } : {}),
      }
    : {
        tone: 'accent',
        title: `Locked to ${who} until {date}`,
        body: ['Only they can redeem it before {date}.', refundCopy, ...sigAll, ...caveat],
        ...(unlockAt ? { dateMs: unlockAt } : {}),
      };
}

/** Substitute the one placeholder the copy uses, once the caller has a date. */
export function withDate(text: string, formattedDate: string): string {
  return text.replace(/\{date\}/g, formattedDate);
}
