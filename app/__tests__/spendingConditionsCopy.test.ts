/**
 * @jest-environment node
 *
 * The sentences the wallet says about somebody's money.
 *
 * The three outcomes NUT-11 allows must never blur into one reassuring line:
 * a permanent lock is final, a locktime with a refund tag is reclaimable, and
 * a locktime without one becomes claimable by anyone holding the token.
 */

import {
  describeSpendingConditionsCopy,
  withDate,
} from '@/features/send/lib/spendingConditionsCopy';
import { describeSpendingConditions } from 'wallet';

const THEIR_KEY = `02${'11'.repeat(32)}`;
const OUR_KEY = `02${'22'.repeat(32)}`;
const NOW = 1_800_000_000_000;
const LOCKTIME_SEC = Math.floor(NOW / 1000) + 3600;
const UNLOCK_AT = LOCKTIME_SEC * 1000;

let nonce = 0;
function proof(data: string, tags: string[][] = [], kind: 'P2PK' | 'HTLC' = 'P2PK') {
  nonce += 1;
  return {
    secret: JSON.stringify([kind, { nonce: nonce.toString(16).padStart(32, '0'), data, tags }]),
  };
}

const copyFor = (
  proofs: { secret: string }[],
  opts: { now?: number; ourPubkeys?: string[]; confirmed?: boolean } = {}
) =>
  describeSpendingConditionsCopy({
    conditions: describeSpendingConditions({
      proofs,
      now: opts.now ?? NOW,
      ...(opts.ourPubkeys ? { ourPubkeys: opts.ourPubkeys } : {}),
    }),
    recipientName: 'Alice',
    ...(opts.confirmed === undefined ? {} : { confirmedRecipient: opts.confirmed }),
  });

const allText = (copy: ReturnType<typeof describeSpendingConditionsCopy>) =>
  copy ? [copy.title, ...copy.body].join(' ') : '';

describe('spending-conditions copy', () => {
  it('says nothing at all about an unlocked token', () => {
    expect(copyFor([{ secret: 'plain-random-secret' }])).toBeNull();
  });

  it('is final about a permanent lock', () => {
    const copy = copyFor([proof(THEIR_KEY)]);
    expect(copy?.title).toBe('Locked to Alice');
    expect(allText(copy)).toMatch(/cannot take it back/);
    expect(copy?.dateMs).toBeUndefined();
  });

  it('promises a way back only when the token carries one', () => {
    const withRefund = copyFor([
      proof(THEIR_KEY, [
        ['locktime', String(LOCKTIME_SEC)],
        ['refund', OUR_KEY],
      ]),
    ]);
    expect(allText(withRefund)).toMatch(/you can take it back/i);
    expect(withRefund?.dateMs).toBe(UNLOCK_AT);

    const withoutRefund = copyFor([proof(THEIR_KEY, [['locktime', String(LOCKTIME_SEC)]])]);
    expect(allText(withoutRefund)).toMatch(/anyone holding the token/i);
    expect(allText(withoutRefund)).not.toMatch(/you can take it back/i);
  });

  it('warns that an expired refund lock is a race, not a guarantee', () => {
    const copy = copyFor(
      [
        proof(THEIR_KEY, [
          ['locktime', String(LOCKTIME_SEC)],
          ['refund', OUR_KEY],
        ]),
      ],
      { now: UNLOCK_AT + 120_000 }
    );
    expect(allText(copy)).toMatch(/They can still redeem it/);
    expect(allText(copy)).toMatch(/whoever spends first wins/);
  });

  it('calls an expired no-refund token what it now is', () => {
    const copy = copyFor([proof(THEIR_KEY, [['locktime', String(LOCKTIME_SEC)]])], {
      now: UNLOCK_AT + 120_000,
    });
    expect(copy?.tone).toBe('danger');
    expect(allText(copy)).toMatch(/plain bearer ecash again/);
  });

  it('adds the unconfirmed caveat without changing the promise', () => {
    const copy = copyFor([proof(THEIR_KEY)], { confirmed: false });
    expect(allText(copy)).toMatch(/couldn't confirm Alice can unlock this/);
  });

  it('says plainly when this wallet cannot redeem a multisig token', () => {
    const copy = copyFor([
      proof(THEIR_KEY, [
        ['pubkeys', OUR_KEY],
        ['n_sigs', '2'],
      ]),
    ]);
    expect(allText(copy)).toMatch(/cannot redeem it/);
  });

  it('does not describe a hash lock as a key lock', () => {
    const copy = copyFor([proof('ff'.repeat(32), [], 'HTLC')]);
    expect(copy?.title).toBe('Hash-locked');
  });

  it('admits when it does not understand the conditions', () => {
    const copy = describeSpendingConditionsCopy({
      conditions: {
        ...describeSpendingConditions({ proofs: [proof(THEIR_KEY)], now: NOW }),
        kind: 'unknown',
      },
      recipientName: null,
    });
    expect(copy?.title).toBe('Unknown spending conditions');
  });

  it('flags a partially locked token instead of summarising it', () => {
    const copy = copyFor([proof(THEIR_KEY), { secret: 'plain-random-secret' }]);
    expect(copy?.title).toBe('Mixed spending conditions');
    expect(allText(copy)).toMatch(/1 of 2 parts/);
  });

  it('falls back to the key rather than naming someone we do not know', () => {
    const copy = describeSpendingConditionsCopy({
      conditions: describeSpendingConditions({ proofs: [proof(THEIR_KEY)], now: NOW }),
      recipientName: null,
    });
    expect(copy?.title).toMatch(/the holder of that key/);
  });

  it('leaves the date for the caller’s locale', () => {
    const copy = copyFor([
      proof(THEIR_KEY, [
        ['locktime', String(LOCKTIME_SEC)],
        ['refund', OUR_KEY],
      ]),
    ]);
    expect(copy?.title).toContain('{date}');
    expect(withDate(copy!.title, '16 Mar 2026')).toContain('16 Mar 2026');
  });
});
