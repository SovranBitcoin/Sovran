/**
 * What ships: a wallet that cannot take a locked send back, and says so.
 *
 * Coco refuses to roll back a P2PK send that has left, and nothing in the
 * unmodified wallet core signs a refund path. Every other lock test switches
 * `P2PK_RECLAIM_ENABLED` on to keep the feature specified; this file leaves it
 * alone, so what it asserts is what a user gets.
 */

import { describe, expect, it } from 'vitest';

import {
  describeRecordedLock,
  describeSpendingConditions,
  normalizeP2pkLock,
  P2PK_RECLAIM_ENABLED,
} from '../../src/p2pk';
import { getAvailableActions } from '../../src/screen-actions/availability';

const THEIR_KEY = `02${'11'.repeat(32)}`;
const OUR_KEY = `02${'22'.repeat(32)}`;
const NOW = 1_800_000_000_000;
const LOCKTIME_SEC = Math.floor(NOW / 1000) + 3600;
/** Well past the locktime and the clock-skew margin. */
const LONG_AFTER = LOCKTIME_SEC * 1000 + 24 * 60 * 60 * 1000;

const timedSecret = JSON.stringify([
  'P2PK',
  {
    nonce: 'ab'.repeat(16),
    data: THEIR_KEY,
    tags: [
      ['locktime', String(LOCKTIME_SEC)],
      ['refund', OUR_KEY],
    ],
  },
]);

describe('the reclaim gate, as shipped', () => {
  it('is off', () => {
    expect(P2PK_RECLAIM_ENABLED).toBe(false);
  });

  it('lets no send apply a timed lock', () => {
    // Every send's lock passes through here, so this is the one refusal no
    // screen, deep link or stale draft can walk around.
    expect(
      normalizeP2pkLock({
        pubkey: THEIR_KEY,
        locktimeSec: LOCKTIME_SEC,
        refundKeys: [OUR_KEY],
      })
    ).toBeNull();
  });

  it('still applies the permanent lock', () => {
    expect(normalizeP2pkLock(THEIR_KEY)).toEqual({ pubkey: THEIR_KEY });
    expect(normalizeP2pkLock({ pubkey: THEIR_KEY })).toEqual({ pubkey: THEIR_KEY });
  });

  it('never says a locked send can be taken back, before the lock opens or after', () => {
    for (const now of [NOW, LONG_AFTER]) {
      expect(
        describeSpendingConditions({
          proofs: [{ secret: timedSecret }],
          now,
          ourPubkeys: [OUR_KEY],
        }).reclaim
      ).toEqual({ kind: 'never', because: 'cannot-sign' });
    }
  });

  it('says the same of a lock rebuilt from the record', () => {
    expect(
      describeRecordedLock({
        lock: { pubkey: THEIR_KEY, locktime: LOCKTIME_SEC, refundKeys: [OUR_KEY] },
        now: LONG_AFTER,
        ourPubkeys: [OUR_KEY],
      }).reclaim
    ).toEqual({ kind: 'never', because: 'cannot-sign' });
  });

  it('keeps the reason a permanent lock already gave', () => {
    const permanent = JSON.stringify([
      'P2PK',
      { nonce: 'ab'.repeat(16), data: THEIR_KEY, tags: [] },
    ]);
    expect(
      describeSpendingConditions({ proofs: [{ secret: permanent }], now: NOW }).reclaim
    ).toEqual({ kind: 'never', because: 'no-refund-tag' });
  });

  it('does not offer to cancel a timed lock once it has opened', () => {
    // Coco would refuse, so the button would be offering a failure.
    const cancel = getAvailableActions(
      'sendToken',
      {
        type: 'send',
        state: 'pending',
        operationId: 'op-1',
        token: { proofs: [{ secret: timedSecret }] },
      },
      LONG_AFTER
    ).cancel;

    expect(cancel.available).toBe(false);
    expect(cancel.reasonCode).toBe('lock-permanent');
  });

  it('still cancels a locked send that never left', () => {
    // Nothing was swapped: the cancel is local and works whatever the lock says.
    expect(
      getAvailableActions(
        'sendToken',
        {
          type: 'send',
          state: 'prepared',
          operationId: 'op-1',
          token: { proofs: [{ secret: timedSecret }] },
        },
        NOW
      ).cancel.available
    ).toBe(true);
  });
});
