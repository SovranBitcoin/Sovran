/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 *
 * reencodeSingleUsePaymentRequest — display re-encode for the single-use
 * "as Ecash" request. Unlike the amountless standing rail, it MUST keep the
 * requested amount and singleUse flag while narrowing mints / attaching a
 * NUT-10 P2PK lock app-side (coco's create() rejects nut10 on incoming).
 */

import { describe, expect, it } from 'vitest';
import { PaymentRequest, decodePaymentRequest } from '@cashu/cashu-ts';

import { reencodeSingleUsePaymentRequest } from '../../src/payment-request-receive';
import { amountToNumber } from '../../src/amount';
import { MINT1, MINT2 } from '../_harness/fixtures';

const LOCK_KEY = `02${'a'.repeat(64)}`;

// A single-use request carrying an amount + two advertised mints (no transport
// so creqB encodes cleanly; the flow uses nostr but the re-encode is transport
// agnostic for this test).
function singleUseCreq(): string {
  return new PaymentRequest(
    undefined,
    'req-single-1',
    100,
    'sat',
    [MINT1, MINT2],
    undefined,
    true, // singleUse
  ).toEncodedRequest();
}

describe('reencodeSingleUsePaymentRequest', () => {
  it('keeps the amount and single-use flag by default', () => {
    const { encodedRequest } = reencodeSingleUsePaymentRequest(singleUseCreq());
    const decoded = decodePaymentRequest(encodedRequest);
    expect(amountToNumber(decoded.amount)).toBe(100);
    expect(decoded.singleUse).toBe(true);
    expect(decoded.unit).toBe('sat');
    expect(decoded.mints).toEqual([MINT1, MINT2]);
  });

  it('narrows the advertised mints to the display subset (amount preserved)', () => {
    const { encodedRequest } = reencodeSingleUsePaymentRequest(singleUseCreq(), {
      displayMints: [MINT1],
    });
    const decoded = decodePaymentRequest(encodedRequest);
    expect(decoded.mints).toEqual([MINT1]);
    expect(amountToNumber(decoded.amount)).toBe(100); // narrowing must not drop the amount
    expect(decoded.singleUse).toBe(true);
  });

  it('attaches a NUT-10 P2PK lock while keeping the amount', () => {
    const { encodedRequest } = reencodeSingleUsePaymentRequest(singleUseCreq(), {
      lockP2pkPubkey: LOCK_KEY,
    });
    const decoded = decodePaymentRequest(encodedRequest);
    expect(decoded.nut10).toMatchObject({ kind: 'P2PK', data: LOCK_KEY });
    expect(amountToNumber(decoded.amount)).toBe(100);
  });

  it('falls back to the full mint list when the display subset is disjoint', () => {
    const { encodedRequest } = reencodeSingleUsePaymentRequest(singleUseCreq(), {
      displayMints: ['https://other.example.com'],
    });
    const decoded = decodePaymentRequest(encodedRequest);
    // Empty intersection would advertise "any mint" — worse — so keep the list.
    expect(decoded.mints).toEqual([MINT1, MINT2]);
  });

  it('emits a lowercase-decodable creqB variant alongside creqA', () => {
    const { encodedRequest, encodedRequestB } = reencodeSingleUsePaymentRequest(
      singleUseCreq(),
    );
    expect(encodedRequest.startsWith('creqA')).toBe(true);
    // creqB is bech32m (case-insensitive); both decode to the same amount.
    expect(amountToNumber(decodePaymentRequest(encodedRequestB.toLowerCase()).amount)).toBe(100);
  });
});
