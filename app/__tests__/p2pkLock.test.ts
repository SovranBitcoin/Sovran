/**
 * @jest-environment node
 */

import { hasP2PKLock, seededLockKey } from '@/features/send/lib/p2pkLock';

const KEY = `02${'11'.repeat(32)}`;

describe('reading a lock off a flow entry', () => {
  it('detects amount and decorated send-token lock state', () => {
    expect(hasP2PKLock({ p2pkLockPubkey: '02-public-key' })).toBe(true);
    expect(hasP2PKLock({ p2pkPubkey: { truncate: jest.fn() } })).toBe(true);
    expect(hasP2PKLock({ metadata: { p2pkLockPubkey: '02-decorated-public-key' } })).toBe(true);
    expect(hasP2PKLock({})).toBe(false);
    expect(hasP2PKLock(null)).toBe(false);
  });

  it('reads the key a flow was seeded with from either form', () => {
    expect(seededLockKey({ p2pkLockPubkey: KEY })).toBe(KEY);
    expect(seededLockKey({ p2pkLock: { pubkey: KEY, locktimeSec: 5 } })).toBe(KEY);
  });

  it('reads no key off a flow that arrived unlocked', () => {
    expect(seededLockKey({})).toBeNull();
    expect(seededLockKey({ p2pkLockPubkey: '' })).toBeNull();
    expect(seededLockKey({ p2pkLock: null })).toBeNull();
    expect(seededLockKey(undefined)).toBeNull();
  });
});
