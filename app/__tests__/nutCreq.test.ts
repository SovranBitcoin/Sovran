/**
 * @jest-environment node
 */

import { buildStandingCreq, lockableMintsFromCreq, parseCreq } from '@/shared/lib/nutCreq';

const NOSTR_HEX = 'ab'.repeat(32);
const PUBKEY_33 = `02${NOSTR_HEX}`;
const MINTS = ['https://mint.a.example', 'https://mint.b.example'];

describe('nutCreq standing payment request', () => {
  it('round-trips mints + the P2PK lock key through a creq', () => {
    const creq = buildStandingCreq({ mints: MINTS, pubkey33: PUBKEY_33 });
    expect(creq).toBeTruthy();
    expect(creq!.toLowerCase().startsWith('creq')).toBe(true);
    // A creq is base64 — it must never contain a colon, so it rides safely
    // inside the `[FAVORITED]:<npub>:<creq>` favorite.
    expect(creq).not.toContain(':');

    const parsed = parseCreq(creq!);
    expect(parsed).not.toBeNull();
    expect(parsed!.mints).toEqual(MINTS);
    expect(parsed!.lockPubkey33).toBe(PUBKEY_33);
  });

  it('returns null when there is no mint to advertise', () => {
    expect(buildStandingCreq({ mints: [], pubkey33: PUBKEY_33 })).toBeNull();
  });

  it('returns null for a malformed P2PK key', () => {
    expect(buildStandingCreq({ mints: MINTS, pubkey33: 'not-a-key' })).toBeNull();
    // x-only (no 02 prefix) is rejected — we always advertise 33-byte keys.
    expect(buildStandingCreq({ mints: MINTS, pubkey33: NOSTR_HEX })).toBeNull();
  });

  it('caps the advertised mint list to five', () => {
    const many = Array.from({ length: 9 }, (_, i) => `https://mint${i}.example`);
    const creq = buildStandingCreq({ mints: many, pubkey33: PUBKEY_33 });
    const parsed = parseCreq(creq!);
    expect(parsed!.mints).toEqual(many.slice(0, 5));
  });

  it('rejects a non-creq string', () => {
    expect(parseCreq('cashuAabc')).toBeNull();
    expect(parseCreq('')).toBeNull();
  });
});

describe('lockableMintsFromCreq capability gate', () => {
  it('returns the accepted mints when the creq lock key matches the npub', () => {
    const creq = buildStandingCreq({ mints: MINTS, pubkey33: PUBKEY_33 })!;
    expect(lockableMintsFromCreq(creq, NOSTR_HEX)).toEqual(MINTS);
  });

  it('rejects a creq whose lock key does NOT match the announced identity', () => {
    const creq = buildStandingCreq({ mints: MINTS, pubkey33: PUBKEY_33 })!;
    // Same valid creq, but the peer's announced npub is a different key →
    // not lockable (guards against a spoofed/mismatched lock target).
    expect(lockableMintsFromCreq(creq, 'cd'.repeat(32))).toBeNull();
  });

  it('returns null when no creq or no npub is present', () => {
    const creq = buildStandingCreq({ mints: MINTS, pubkey33: PUBKEY_33 })!;
    expect(lockableMintsFromCreq(undefined, NOSTR_HEX)).toBeNull();
    expect(lockableMintsFromCreq(creq, undefined)).toBeNull();
  });
});
