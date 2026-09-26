/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * payment-request.ts — canonical NUT-18 payment request decoder.
 */

import { describe, expect, it } from 'vitest';
import { decodePaymentRequest, PaymentRequest, type NUT10Option } from '@cashu/cashu-ts';

import {
  decodePaymentRequestInfo,
  lockableMintsFromRequest,
} from '../../src/payment-request';
import { defaultDetectors } from '../../src/detectors';
import { INPUTS, MINT1 } from '../_harness/fixtures';

const LOCK_KEY = `02${'a'.repeat(64)}`;
const LOCK_HEX = 'a'.repeat(64);

/** A creq locked to `pubkey33`, built here because the CBOR fixtures only
 *  carry the `02` parity and NUT-11 allows `03` for the same key. */
function lockedRequest(pubkey33: string): string {
  return new PaymentRequest(
    undefined,
    undefined,
    50,
    'sat',
    [MINT1],
    undefined,
    false,
    { kind: 'P2PK', data: pubkey33, tags: [] } satisfies NUT10Option,
  ).toEncodedRequest();
}

describe('decodePaymentRequestInfo', () => {
  it('decodes mints + amount', () => {
    const info = decodePaymentRequestInfo(INPUTS.paymentRequestBasic);
    expect(info).not.toBeNull();
    expect(info!.mints).toEqual([MINT1]);
    expect(info!.amount).toBe(100);
    expect(info!.unit).toBe('sat');
    expect(info!.lockP2pkPubkey).toBeNull();
  });

  it('surfaces the nut10 P2PK lock key', () => {
    const info = decodePaymentRequestInfo(INPUTS.paymentRequestLocked);
    expect(info!.lockP2pkPubkey).toBe(LOCK_KEY);
  });

  it('returns null for non-request input', () => {
    expect(decodePaymentRequestInfo(INPUTS.randomString)).toBeNull();
    expect(decodePaymentRequestInfo(INPUTS.cashuTokenV3)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Both encodings, both cases.
//
// We EMIT mixed-case creqA (NUT-18 base64url) to match cashu.me / the SDK
// default — base64url is case-sensitive, so it must not be re-cased. But a
// payer wallet may hand us a creqB (NUT-26 bech32m), which IS case-insensitive
// and conventionally uppercase. The parser must accept creqA as-emitted AND
// creqB in either case. These lock that contract.
// ---------------------------------------------------------------------------
describe('decodePaymentRequestInfo — creqA + creqB, both cases', () => {
  // Re-encode the basic creqA fixture as creqB (uppercase CREQB…, per cashu-ts).
  const creqBUpper = decodePaymentRequest(INPUTS.paymentRequestBasic).toEncodedCreqB();

  it('decodes an uppercase creqB (NUT-26 bech32m) identically to creqA', () => {
    const info = decodePaymentRequestInfo(creqBUpper);
    expect(info).not.toBeNull();
    expect(info!.mints).toEqual([MINT1]);
    expect(info!.amount).toBe(100);
    expect(info!.unit).toBe('sat');
  });

  it('decodes a lowercase creqB (bech32m is case-insensitive)', () => {
    const info = decodePaymentRequestInfo(creqBUpper.toLowerCase());
    expect(info).not.toBeNull();
    expect(info!.mints).toEqual([MINT1]);
    expect(info!.amount).toBe(100);
  });

  it('detector recognizes creqA (as emitted) and creqB in either case', () => {
    // creqA base64url is never re-cased (case-sensitive); creqB bech32m is.
    for (const s of [
      INPUTS.paymentRequestBasic, // creqA… (mixed, as emitted)
      creqBUpper, // CREQB… (uppercase)
      creqBUpper.toLowerCase(), // creqb… (lowercase)
    ]) {
      expect(defaultDetectors.isPaymentRequest(s)).toBe(true);
    }
  });
});

describe('lockableMintsFromRequest', () => {
  it('returns mints when the lock matches 02 + nostr pubkey', () => {
    expect(lockableMintsFromRequest(INPUTS.paymentRequestLocked, LOCK_HEX)).toEqual([
      MINT1,
    ]);
  });

  // NUT-11: `02<x>` and `03<x>` are the SAME key — only the x coordinate is
  // carried by NIP-01, so a SEC1-compressed key from another wallet may arrive
  // with either parity and must still resolve to us.
  it('matches a lock that uses the 03 parity for the same x coordinate', () => {
    expect(lockableMintsFromRequest(lockedRequest(`03${LOCK_HEX}`), LOCK_HEX)).toEqual([
      MINT1,
    ]);
  });

  it('still rejects a 03 lock whose x coordinate is someone else', () => {
    expect(
      lockableMintsFromRequest(lockedRequest(`03${'b'.repeat(64)}`), LOCK_HEX),
    ).toBeNull();
  });

  it('returns null on lock mismatch', () => {
    expect(
      lockableMintsFromRequest(INPUTS.paymentRequestLocked, 'b'.repeat(64)),
    ).toBeNull();
  });

  it('returns null when the request has no lock', () => {
    expect(
      lockableMintsFromRequest(INPUTS.paymentRequestBasic, LOCK_HEX),
    ).toBeNull();
  });

  it('returns null for missing inputs', () => {
    expect(lockableMintsFromRequest(undefined, LOCK_HEX)).toBeNull();
    expect(lockableMintsFromRequest(INPUTS.paymentRequestLocked, undefined)).toBeNull();
  });
});
