/**
 * What a token's spending conditions say — the model every lock surface reads.
 *
 * The rule these tests exist to hold: the model never claims more than the
 * secret establishes. In particular it distinguishes the three shapes users
 * confuse, and wallets get wrong:
 *
 *   - permanent lock            → nobody but the recipient, ever
 *   - locktime + refund tag     → the sender can take it back afterwards
 *   - locktime, NO refund tag   → ANYONE can take it afterwards
 *
 * `now` is injected everywhere. If a `Date.now()` ever creeps into the model,
 * the frozen-time cases below stop being deterministic.
 */

import { describe, expect, it } from 'vitest';

import {
  describeSpendingConditions,
  LOCK_CLOCK_SKEW_MS,
  type ReclaimVerdict,
  type SpendingConditions,
} from '../../src/p2pk';

const THEIR_KEY = `02${'11'.repeat(32)}`;
const OUR_KEY = `02${'22'.repeat(32)}`;
const OUR_KEY_ODD = `03${'22'.repeat(32)}`;
const OTHER_KEY = `02${'33'.repeat(32)}`;

const NOW = 1_800_000_000_000; // ms
const LOCKTIME_SEC = Math.floor(NOW / 1000) + 3600; // an hour out
const UNLOCK_AT = LOCKTIME_SEC * 1000;

let nonce = 0;

function lockedProof(
  data: string,
  tags: string[][] = [],
  kind: 'P2PK' | 'HTLC' = 'P2PK'
) {
  nonce += 1;
  return {
    secret: JSON.stringify([
      kind,
      { nonce: nonce.toString(16).padStart(32, '0'), data, tags },
    ]),
  };
}

const bearerProof = { secret: 'a-plain-random-secret' };

function describe_(
  proofs: { secret: string }[],
  now = NOW,
  ourPubkeys?: string[]
): SpendingConditions {
  return describeSpendingConditions({ proofs, now, ...(ourPubkeys ? { ourPubkeys } : {}) });
}

/** Every verdict the UI must be able to render. */
const EVERY_VERDICT: ReclaimVerdict['kind'][] = ['not-locked', 'unknown', 'never', 'at', 'now'];

describe('describeSpendingConditions — nothing is locked', () => {
  it('reads plain bearer proofs as unlocked', () => {
    const c = describe_([bearerProof, bearerProof]);
    expect(c.kind).toBe('unlocked');
    expect(c.phase).toBeNull();
    expect(c.lockedProofCount).toBe(0);
    expect(c.proofCount).toBe(2);
    expect(c.reclaim).toEqual({ kind: 'not-locked' });
  });
});

describe('describeSpendingConditions — permanent lock', () => {
  it('has no unlock date and can never be taken back', () => {
    const c = describe_([lockedProof(THEIR_KEY)], NOW, [OUR_KEY]);
    expect(c.kind).toBe('p2pk');
    expect(c.phase).toBe('permanent');
    expect(c.unlockAt).toBeNull();
    expect(c.refund).toBeNull();
    expect(c.reclaim).toEqual({ kind: 'never', because: 'no-refund-tag' });
  });

  it('knows when it is locked to us', () => {
    const c = describe_([lockedProof(OUR_KEY)], NOW, [OUR_KEY]);
    expect(c.main?.ourKeys).toBe(1);
  });

  it('matches our key whatever parity it was written with', () => {
    // NUT-11 compares by x coordinate; 02 and 03 are the same signer.
    const c = describe_([lockedProof(OUR_KEY_ODD)], NOW, [OUR_KEY]);
    expect(c.main?.ourKeys).toBe(1);
  });
});

describe('describeSpendingConditions — locktime with a refund to us', () => {
  const proof = () =>
    lockedProof(THEIR_KEY, [
      ['locktime', String(LOCKTIME_SEC)],
      ['refund', OUR_KEY],
    ]);

  it('is active before the locktime, and says when it opens', () => {
    const c = describe_([proof()], NOW, [OUR_KEY]);
    expect(c.phase).toBe('timed-active');
    expect(c.unlockAt).toBe(UNLOCK_AT);
    expect(c.reclaim).toEqual({ kind: 'at', at: UNLOCK_AT, via: 'refund' });
  });

  it('becomes reclaimable once the locktime AND the clock-skew margin pass', () => {
    // Exactly at the locktime the mint may still disagree with our clock.
    expect(describe_([proof()], UNLOCK_AT, [OUR_KEY]).reclaim).toMatchObject({
      kind: 'at',
    });
    expect(
      describe_([proof()], UNLOCK_AT + LOCK_CLOCK_SKEW_MS, [OUR_KEY]).reclaim
    ).toEqual({ kind: 'now', via: 'refund' });
  });

  it('still reports the token\'s own date, not the date plus our margin', () => {
    const c = describe_([proof()], NOW, [OUR_KEY]);
    expect(c.unlockAt).toBe(UNLOCK_AT);
  });

  it('will not promise a reclaim with someone else\'s refund key', () => {
    const c = describe_(
      [lockedProof(THEIR_KEY, [['locktime', String(LOCKTIME_SEC)], ['refund', OTHER_KEY]])],
      NOW,
      [OUR_KEY]
    );
    expect(c.reclaim).toEqual({ kind: 'never', because: 'not-our-key' });
  });

  it('says "unknown" rather than guessing when we were not told our keys', () => {
    const c = describe_([proof()], NOW);
    expect(c.refund?.ourKeys).toBeNull();
    expect(c.reclaim).toEqual({ kind: 'unknown' });
  });

  it('refuses a refund it cannot sign for alone', () => {
    const c = describe_(
      [
        lockedProof(THEIR_KEY, [
          ['locktime', String(LOCKTIME_SEC)],
          ['refund', OUR_KEY, OTHER_KEY],
          ['n_sigs_refund', '2'],
        ]),
      ],
      NOW,
      [OUR_KEY]
    );
    expect(c.reclaim).toEqual({ kind: 'never', because: 'cannot-sign' });
    expect(c.limits).toContain('multisig');
  });
});

describe('describeSpendingConditions — locktime with NO refund tag', () => {
  const proof = () => lockedProof(THEIR_KEY, [['locktime', String(LOCKTIME_SEC)]]);

  it('becomes spendable by anyone, and says so', () => {
    const before = describe_([proof()], NOW, [OUR_KEY]);
    expect(before.refund).toBeNull();
    expect(before.reclaim).toEqual({ kind: 'at', at: UNLOCK_AT, via: 'public' });

    const after = describe_([proof()], UNLOCK_AT + LOCK_CLOCK_SKEW_MS, [OUR_KEY]);
    expect(after.phase).toBe('timed-expired');
    expect(after.reclaim).toEqual({ kind: 'now', via: 'public' });
  });
});

describe('describeSpendingConditions — shapes this wallet cannot claim', () => {
  it('flags multisig on the main path', () => {
    const c = describe_(
      [lockedProof(THEIR_KEY, [['pubkeys', OTHER_KEY], ['n_sigs', '2']])],
      NOW,
      [OUR_KEY]
    );
    expect(c.main?.pubkeys).toEqual([THEIR_KEY, OTHER_KEY]);
    expect(c.main?.requiredSignatures).toBe(2);
    expect(c.limits).toContain('multisig');
  });

  it('flags SIG_ALL', () => {
    const c = describe_([lockedProof(THEIR_KEY, [['sigflag', 'SIG_ALL']])], NOW, [OUR_KEY]);
    expect(c.sigFlag).toBe('SIG_ALL');
    expect(c.limits).toContain('sig-all');
  });

  it('flags a hash lock as an HTLC, not a key lock', () => {
    const c = describe_([lockedProof('ff'.repeat(32), [], 'HTLC')], NOW, [OUR_KEY]);
    expect(c.kind).toBe('htlc');
    expect(c.limits).toContain('htlc');
  });

  it('surfaces tags it does not model instead of ignoring them', () => {
    const c = describe_([lockedProof(THEIR_KEY, [['something_new', 'x']])], NOW, [OUR_KEY]);
    expect(c.unknownTags).toEqual(['something_new']);
  });
});

describe('describeSpendingConditions — mixed tokens', () => {
  it('flags a token whose proofs are not all locked', () => {
    const c = describe_([lockedProof(THEIR_KEY), bearerProof], NOW, [OUR_KEY]);
    expect(c.mixed).toBe(true);
    expect(c.lockedProofCount).toBe(1);
    expect(c.proofCount).toBe(2);
  });

  it('flags a token locked to two different keys', () => {
    const c = describe_([lockedProof(THEIR_KEY), lockedProof(OTHER_KEY)], NOW, [OUR_KEY]);
    expect(c.mixed).toBe(true);
  });

  it('does not flag a token whose proofs all share one condition set', () => {
    const c = describe_([lockedProof(THEIR_KEY), lockedProof(THEIR_KEY)], NOW, [OUR_KEY]);
    expect(c.mixed).toBe(false);
  });
});

describe('describeSpendingConditions — the verdict vocabulary', () => {
  it('produces every verdict kind the UI has to render', () => {
    const proofWithRefund = lockedProof(THEIR_KEY, [
      ['locktime', String(LOCKTIME_SEC)],
      ['refund', OUR_KEY],
    ]);
    const produced = new Set([
      describe_([bearerProof]).reclaim.kind,
      describe_([proofWithRefund]).reclaim.kind, // no ourPubkeys ⇒ unknown
      describe_([lockedProof(THEIR_KEY)], NOW, [OUR_KEY]).reclaim.kind,
      describe_([proofWithRefund], NOW, [OUR_KEY]).reclaim.kind,
      describe_([proofWithRefund], UNLOCK_AT + LOCK_CLOCK_SKEW_MS, [OUR_KEY]).reclaim.kind,
    ]);
    expect([...produced].sort()).toEqual([...EVERY_VERDICT].sort());
  });
});

describe('describeSpendingConditions — malformed input', () => {
  it('treats an unparseable locktime as no locktime rather than as expired', () => {
    // Reading a junk locktime as 0 would report a permanent lock as expired,
    // and offer a reclaim the mint will refuse.
    const c = describe_([lockedProof(THEIR_KEY, [['locktime', 'soon']])], NOW, [OUR_KEY]);
    expect(c.phase).toBe('permanent');
    expect(c.unlockAt).toBeNull();
  });
});
