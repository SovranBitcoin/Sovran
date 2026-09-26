/**
 * @jest-environment node
 *
 * A payment token's spelling on the wire to a Routstr node.
 *
 * Minibits rotated onto a version-1 keyset (`01fc0ec0e59cd6fa01b7…a821`) and
 * `@cashu/cashu-ts` v5 writes only its 8-byte short form into a V4 token. A
 * node older than routstr-core v0.4.5 keys its wallet by the full id and never
 * expands the short one: `Keyset 01fc0ec0e59cd6fa not known, can not verify
 * DLEQ` (400, `node1.routstr.blazelight.dev`, 0.4.3) and `Internal error
 * during token redemption` (500, `ai.orangesync.tech`, 0.4.4) in the
 * 2026-09-26 log — the only two payment-layer failures, on the only two
 * pre-0.4.5 nodes. These pin the client's half: a version-1 id goes out whole.
 */

import { Amount, getTokenMetadata, type Token } from '@cashu/cashu-ts';

import {
  decodeWireToken,
  encodeTokenForNode,
  keysetIdsOf,
  needsFullKeysetIds,
  toWalletToken,
  wireTokenAmount,
} from '@/shared/lib/routstr/tokenWire';

/** Minibits' active keyset on 2026-09-26, as `/v1/keysets` lists it. */
const V1_KEYSET = '01fc0ec0e59cd6fa01b7a88f8cd77fce81fd1e64bca67d752e984992b7a3c3a821';
/** One of its retired version-0 keysets. */
const V0_KEYSET = '00500550f0494146';
const MINT = 'https://mint.minibits.cash/Bitcoin';
const C = '02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2';

const proof = (id: string, amount: number, secret: string) => ({
  id,
  amount: Amount.from(amount),
  secret,
  C,
});

const token = (proofs: Token['proofs']): Token => ({ mint: MINT, unit: 'sat', proofs });

describe('the token a node receives', () => {
  it('keeps the compact V4 form for a version-0 keyset, whose id V4 carries whole', () => {
    const t = token([proof(V0_KEYSET, 8, 'a'.repeat(64))]);
    expect(needsFullKeysetIds(t)).toBe(false);
    const { encoded, wire } = encodeTokenForNode(t);
    expect(wire).toBe('v4');
    expect(encoded.startsWith('cashuB')).toBe(true);
    expect(decodeWireToken(encoded)).toBeNull();
  });

  it('spells a version-1 keyset id in full, in the V3 form every node reads', () => {
    const t = token([proof(V1_KEYSET, 512, 'b'.repeat(64)), proof(V1_KEYSET, 389, 'c'.repeat(64))]);
    expect(needsFullKeysetIds(t)).toBe(true);
    const { encoded, wire } = encodeTokenForNode(t);
    expect(wire).toBe('v3');
    expect(encoded.startsWith('cashuA')).toBe(true);
    const decoded = decodeWireToken(encoded);
    expect(decoded).toEqual({
      token: [
        {
          mint: MINT,
          proofs: [
            { id: V1_KEYSET, amount: 512, secret: 'b'.repeat(64), C },
            { id: V1_KEYSET, amount: 389, secret: 'c'.repeat(64), C },
          ],
        },
      ],
      unit: 'sat',
    });
    // The whole id, never the eight-byte prefix a V4 token would carry.
    expect(encoded.includes('cashuB')).toBe(false);
    expect(JSON.stringify(decoded)).toContain(V1_KEYSET);
  });

  it('comes back to the wallet as the V4 the wallet can read', () => {
    const t = token([proof(V1_KEYSET, 901, 'd'.repeat(64))]);
    const { encoded } = encodeTokenForNode(t);
    const wallet = toWalletToken(encoded);
    expect(wallet.startsWith('cashuB')).toBe(true);
    const metadata = getTokenMetadata(wallet);
    expect(metadata.amount.toNumber()).toBe(901);
    expect(metadata.unit).toBe('sat');
    expect(metadata.mint).toBe(MINT);
  });

  it('passes a V4 string through untouched', () => {
    const { encoded } = encodeTokenForNode(token([proof(V0_KEYSET, 5, 'e'.repeat(64))]));
    expect(toWalletToken(encoded)).toBe(encoded);
  });

  it('reads the amount of either spelling, and nothing from garbage', () => {
    const v3 = encodeTokenForNode(token([proof(V1_KEYSET, 300, 'f'.repeat(64))])).encoded;
    const v4 = encodeTokenForNode(token([proof(V0_KEYSET, 7, '1'.repeat(64))])).encoded;
    expect(wireTokenAmount(v3)).toEqual({ amount: 300, unit: 'sat' });
    expect(wireTokenAmount(v4)).toEqual({ amount: 7, unit: 'sat' });
    expect(wireTokenAmount('cashuAnot-base64!')).toBeNull();
    expect(wireTokenAmount('hello')).toBeNull();
  });

  it('counts the keysets a token spans, which every released node caps at one', () => {
    expect(keysetIdsOf(token([proof(V1_KEYSET, 1, 'a'), proof(V1_KEYSET, 2, 'b')]))).toEqual([
      V1_KEYSET,
    ]);
    expect(keysetIdsOf(token([proof(V1_KEYSET, 1, 'a'), proof(V0_KEYSET, 2, 'b')]))).toEqual([
      V1_KEYSET,
      V0_KEYSET,
    ]);
  });
});
