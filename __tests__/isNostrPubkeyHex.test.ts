/**
 * Pins the trust-boundary predicate that gates Nostr pubkey strings
 * before they cross into NDK / Primal filters (audit 26#F-005).
 *
 * The previous inline check at HomeFeed.tsx accepted any 64-char string,
 * including arbitrary UTF-8 / mojibake / `01javascript:alert(1)01…`
 * padded to 64 chars — the regex-charset gate is the load-bearing part.
 */

import { isNostrPubkeyHex } from '@/shared/lib/nostr/secureStorage';

describe('isNostrPubkeyHex', () => {
  it('accepts canonical 64-char lowercase hex', () => {
    expect(isNostrPubkeyHex('0'.repeat(64))).toBe(true);
    expect(isNostrPubkeyHex('a'.repeat(64))).toBe(true);
    expect(
      isNostrPubkeyHex('deadbeef'.repeat(8)) // 64 chars
    ).toBe(true);
  });

  it('accepts mixed-case hex (HEX_RE is case-insensitive)', () => {
    expect(isNostrPubkeyHex('A'.repeat(64))).toBe(true);
    expect(isNostrPubkeyHex('aBcDeF01'.repeat(8))).toBe(true);
  });

  it('rejects 64-char strings with non-hex characters', () => {
    // The exact attack shape called out in audit 26#F-005: a 64-char
    // string the length check accepts but the charset check rejects.
    const malicious = ('01javascript:alert(1)01' + 'x'.repeat(64)).slice(0, 64);
    expect(malicious).toHaveLength(64);
    expect(isNostrPubkeyHex(malicious)).toBe(false);
    expect(isNostrPubkeyHex('z'.repeat(64))).toBe(false);
    expect(isNostrPubkeyHex('-'.repeat(64))).toBe(false);
  });

  it('rejects wrong-length hex', () => {
    expect(isNostrPubkeyHex('a'.repeat(63))).toBe(false);
    expect(isNostrPubkeyHex('a'.repeat(65))).toBe(false);
    expect(isNostrPubkeyHex('')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isNostrPubkeyHex(undefined)).toBe(false);
    expect(isNostrPubkeyHex(null)).toBe(false);
    expect(isNostrPubkeyHex(123)).toBe(false);
    expect(isNostrPubkeyHex({})).toBe(false);
    expect(isNostrPubkeyHex(['a'.repeat(64)])).toBe(false);
  });
});
