/**
 * hashMnemonic binds cached derived-keys / cashu-mnemonic / cashu-seed blobs
 * in SecureStore to a specific mnemonic. The previous implementation was a
 * 32-bit djb2 fingerprint with birthday-bound collisions around ~65K
 * mnemonics — small enough that family-share install chains could return a
 * prior install's identity from cache on restore. This test pins the
 * stronger hash so a future drive-by "make it shorter / faster" doesn't
 * silently regress identity isolation.
 */

import { hashMnemonic } from '@/shared/lib/nostr/secureStorage';

const MNEMONIC_A = 'leader monkey parrot ring guide accident before fence cannon height naive bean';
const MNEMONIC_B =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('hashMnemonic', () => {
  it('produces 16 lowercase hex chars (64 bits)', () => {
    expect(hashMnemonic(MNEMONIC_A)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic across calls', () => {
    expect(hashMnemonic(MNEMONIC_A)).toBe(hashMnemonic(MNEMONIC_A));
  });

  it('distinguishes distinct mnemonics', () => {
    expect(hashMnemonic(MNEMONIC_A)).not.toBe(hashMnemonic(MNEMONIC_B));
  });

  it('distinguishes mnemonics that differ by a single word', () => {
    const altered = 'leader monkey parrot ring guide accident before fence cannon height naive zoo';
    expect(hashMnemonic(MNEMONIC_A)).not.toBe(hashMnemonic(altered));
  });

  it('matches truncated SHA-256(utf8(mnemonic)) — pinned algorithm', () => {
    // First 16 hex chars of sha256(utf8(MNEMONIC_B)). If this constant
    // changes, the cache-key invariant has changed and every existing cached
    // derived-keys / cashu-seed blob will miss. Update intentionally with a
    // migration plan, not as a drive-by.
    expect(hashMnemonic(MNEMONIC_B)).toBe('c557eec878dfd852');
  });
});
