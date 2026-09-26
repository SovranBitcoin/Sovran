/**
 * The lock a send applies, and the two NUT-11 shapes it must refuse.
 *
 * Both refusals protect the same person — the sender, who believes the lock
 * means what the UI told them it means.
 */

import { describe, expect, it } from 'vitest';

import { isLockedSend, normalizeP2pkLock } from '../../src/p2pk';

const THEIR_KEY = `02${'11'.repeat(32)}`;
const OUR_KEY = `02${'22'.repeat(32)}`;
const ODD_KEY = `03${'33'.repeat(32)}`;
const LOCKTIME = 1_800_003_600;

describe('normalizeP2pkLock', () => {
  it('accepts a bare key as a permanent lock', () => {
    expect(normalizeP2pkLock(THEIR_KEY)).toEqual({ pubkey: THEIR_KEY });
  });

  it('accepts an odd-parity key from another wallet', () => {
    // The old send-flow guard hardcoded ^02, which would have rejected every
    // key a non-nostr wallet publishes.
    expect(normalizeP2pkLock(ODD_KEY)).toEqual({ pubkey: ODD_KEY });
  });

  it('lowercases keys so a comparison never turns on case', () => {
    expect(normalizeP2pkLock(THEIR_KEY.toUpperCase())).toEqual({
      pubkey: THEIR_KEY,
    });
  });

  it('accepts a locktime paired with a refund key', () => {
    expect(
      normalizeP2pkLock({
        pubkey: THEIR_KEY,
        locktimeSec: LOCKTIME,
        refundKeys: [OUR_KEY],
      })
    ).toEqual({
      pubkey: THEIR_KEY,
      locktimeSec: LOCKTIME,
      refundKeys: [OUR_KEY],
    });
  });

  it('refuses a locktime with no refund keys', () => {
    // NUT-11: once the locktime passes and there is no refund tag, the proof
    // needs no signature at all. The sender would have been told the opposite.
    expect(
      normalizeP2pkLock({ pubkey: THEIR_KEY, locktimeSec: LOCKTIME })
    ).toBeNull();
  });

  it('refuses refund keys with no locktime', () => {
    // The refund path only opens after a locktime, so these keys could never
    // be used — and cashu-ts throws on the same shape.
    expect(
      normalizeP2pkLock({ pubkey: THEIR_KEY, refundKeys: [OUR_KEY] })
    ).toBeNull();
  });

  it('refuses a malformed key rather than dropping the lock', () => {
    expect(normalizeP2pkLock('not-a-key')).toBeNull();
    expect(normalizeP2pkLock(`04${'11'.repeat(32)}`)).toBeNull();
    expect(
      normalizeP2pkLock({
        pubkey: THEIR_KEY,
        locktimeSec: LOCKTIME,
        refundKeys: ['nonsense'],
      })
    ).toBeNull();
  });

  it('refuses a locktime that is not a whole number of seconds', () => {
    expect(
      normalizeP2pkLock({
        pubkey: THEIR_KEY,
        locktimeSec: LOCKTIME + 0.5,
        refundKeys: [OUR_KEY],
      })
    ).toBeNull();
  });

  it('is null for nothing at all', () => {
    expect(normalizeP2pkLock(undefined)).toBeNull();
    expect(normalizeP2pkLock(null)).toBeNull();
    expect(normalizeP2pkLock('')).toBeNull();
  });
});

describe('isLockedSend', () => {
  it('sees a lock in either shape the context may carry', () => {
    expect(isLockedSend({ p2pkLock: { pubkey: THEIR_KEY } })).toBe(true);
    expect(isLockedSend({ p2pkLockPubkey: THEIR_KEY })).toBe(true);
    expect(isLockedSend({})).toBe(false);
  });
});
