/**
 * @jest-environment node
 */

import { CompressedPubkey, Geohash, Hex16, HttpsUrl, Npub } from '@/shared/lib/nav/routeSchemas';

describe('route trust-boundary schemas', () => {
  it('accepts bounded HTTPS URLs and rejects insecure, whitespace, and overlong input', () => {
    expect(HttpsUrl.safeParse('https://mint.example/Bitcoin').success).toBe(true);
    expect(HttpsUrl.safeParse('http://mint.example').success).toBe(false);
    expect(HttpsUrl.safeParse('https://mint.example/a path').success).toBe(false);
    expect(HttpsUrl.safeParse(`https://example.com/${'a'.repeat(2040)}`).success).toBe(false);
  });

  it('accepts only lowercase compressed secp256k1 public keys', () => {
    expect(CompressedPubkey.safeParse(`02${'ab'.repeat(32)}`).success).toBe(true);
    expect(CompressedPubkey.safeParse(`03${'AB'.repeat(32)}`).success).toBe(false);
    expect(CompressedPubkey.safeParse(`04${'ab'.repeat(64)}`).success).toBe(false);
    expect(CompressedPubkey.safeParse(`02${'ab'.repeat(31)}`).success).toBe(false);
  });

  it('distinguishes npub from nsec-shaped bech32 input', () => {
    expect(Npub.safeParse(`npub1${'q'.repeat(58)}`).success).toBe(true);
    expect(Npub.safeParse(`nsec1${'q'.repeat(58)}`).success).toBe(false);
    expect(Npub.safeParse('npub1short').success).toBe(false);
  });

  it('enforces the geohash alphabet and length', () => {
    expect(Geohash.safeParse('gcpvj0du').success).toBe(true);
    for (const excluded of ['a', 'i', 'l', 'o']) {
      expect(Geohash.safeParse(`gcpv${excluded}`).success).toBe(false);
    }
    expect(Geohash.safeParse('g'.repeat(13)).success).toBe(false);
  });

  it('accepts exactly sixteen lowercase hex characters for BLE peer ids', () => {
    expect(Hex16.safeParse('0123456789abcdef').success).toBe(true);
    expect(Hex16.safeParse('0123456789ABCDEF').success).toBe(false);
    expect(Hex16.safeParse('0123456789abcde').success).toBe(false);
    expect(Hex16.safeParse('0123456789abcdef0').success).toBe(false);
  });
});
