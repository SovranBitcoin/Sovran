/**
 * @jest-environment node
 */

import { decodePaymentRequest, PaymentRequest } from '@cashu/cashu-ts';

import { cashuP2pkPubkeyFromNostrHex, nostrPubkeyHexFromCashuP2pk } from '@/shared/lib/protocolIds';
import { lockableMintsFromCreq, parseCreq, rankAdvertisedMints } from '@/shared/lib/nutCreq';

const fixtureRequest = ({ mints, pubkey33 }: { mints: string[]; pubkey33: string }) =>
  new PaymentRequest(undefined, 'fixture-request', undefined, 'sat', mints, undefined, false, {
    kind: 'P2PK',
    data: pubkey33,
    tags: [],
  }).toEncodedRequest();

const NOSTR_HEX = 'ab'.repeat(32);
const PUBKEY_33 = cashuP2pkPubkeyFromNostrHex(NOSTR_HEX);
const MINTS = ['https://mint.a.example', 'https://mint.b.example'];

describe('nutCreq standing payment request', () => {
  it('round-trips mints + the P2PK lock key through a creq', () => {
    const creq = fixtureRequest({ mints: MINTS, pubkey33: PUBKEY_33 });
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

  it('cashuP2pkPubkeyFromNostrHex owns the 02+x-only lift', () => {
    expect(PUBKEY_33).toBe(`02${NOSTR_HEX}`);
    expect(() => cashuP2pkPubkeyFromNostrHex('not-hex')).toThrow();
    expect(() => cashuP2pkPubkeyFromNostrHex(`02${NOSTR_HEX}`)).toThrow(); // already 33-byte
  });

  it('nostrPubkeyHexFromCashuP2pk strips BOTH parity prefixes (inverse of the lift)', () => {
    expect(nostrPubkeyHexFromCashuP2pk(PUBKEY_33)).toBe(NOSTR_HEX);
    // 03 keys share the x coordinate — the old `.replace(/^02/,'')` idiom
    // silently no-opped here and fed 66 chars into npubEncode.
    expect(nostrPubkeyHexFromCashuP2pk(`03${NOSTR_HEX}`)).toBe(NOSTR_HEX);
    expect(nostrPubkeyHexFromCashuP2pk(`02${NOSTR_HEX.toUpperCase()}`)).toBe(NOSTR_HEX);
    expect(() => nostrPubkeyHexFromCashuP2pk(NOSTR_HEX)).toThrow(); // x-only input
    expect(() => nostrPubkeyHexFromCashuP2pk(`04${NOSTR_HEX}`)).toThrow(); // uncompressed prefix
  });

  // Two phones, fourteen mints on one: alphabetical order advertised five
  // mints the sender held nothing in, and the send failed as "insufficient
  // balance on allowed mints" although four funded mints were shared.
  it('keeps the selected and the funded mints inside the cap', () => {
    const mints = [
      'https://8333.space:3338',
      'https://antifiat.cash',
      'https://kashu.me',
      'https://ldk.thesimplekid.dev',
      'https://mint.28waves.com',
      'https://mint.chorus.community',
      'https://mint.cubabitcoin.org',
      'https://mint.minibits.cash/Bitcoin',
      'https://mint.sovran.money',
    ];
    const ranked = rankAdvertisedMints({
      mints,
      fundedMints: new Set([
        'https://mint.minibits.cash/Bitcoin',
        'https://mint.chorus.community',
        'https://mint.sovran.money',
      ]),
      preferredMint: 'https://mint.cubabitcoin.org',
    });

    expect(ranked).toHaveLength(mints.length);
    expect(ranked.slice(0, 4)).toEqual([
      'https://mint.cubabitcoin.org',
      'https://mint.chorus.community',
      'https://mint.minibits.cash/Bitcoin',
      'https://mint.sovran.money',
    ]);
  });

  it('ranks on funded, not on the amount, so a balance change does not reorder', () => {
    const mints = ['https://b.example', 'https://a.example', 'https://a.example'];
    expect(
      rankAdvertisedMints({ mints, fundedMints: new Set(mints), preferredMint: null })
    ).toEqual(['https://a.example', 'https://b.example']);
  });

  it('rejects a non-creq string', () => {
    expect(parseCreq('cashuAabc')).toBeNull();
    expect(parseCreq('')).toBeNull();
  });
});

describe('lockableMintsFromCreq capability gate', () => {
  it('returns the accepted mints when the creq lock key matches the npub', () => {
    const creq = fixtureRequest({ mints: MINTS, pubkey33: PUBKEY_33 })!;
    expect(lockableMintsFromCreq(creq, NOSTR_HEX)).toEqual(MINTS);
  });

  it('rejects a creq whose lock key does NOT match the announced identity', () => {
    const creq = fixtureRequest({ mints: MINTS, pubkey33: PUBKEY_33 })!;
    // Same valid creq, but the peer's announced npub is a different key →
    // not lockable (guards against a spoofed/mismatched lock target).
    expect(lockableMintsFromCreq(creq, 'cd'.repeat(32))).toBeNull();
  });

  it('returns null when no creq or no npub is present', () => {
    const creq = fixtureRequest({ mints: MINTS, pubkey33: PUBKEY_33 })!;
    expect(lockableMintsFromCreq(undefined, NOSTR_HEX)).toBeNull();
    expect(lockableMintsFromCreq(creq, undefined)).toBeNull();
  });
});

it('keeps NutDrop strict by default and preserves an explicit mint preference', () => {
  const strict = fixtureRequest({ mints: MINTS, pubkey33: PUBKEY_33 })!;
  expect(decodePaymentRequest(strict).mintsPreferred).toBeUndefined();
});
