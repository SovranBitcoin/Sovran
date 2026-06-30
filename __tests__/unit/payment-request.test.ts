/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * payment-request.ts — canonical NUT-18 payment request decoder.
 */

import { describe, expect, it } from 'vitest';

import {
  decodePaymentRequestInfo,
  lockableMintsFromRequest,
} from '../../src/payment-request';
import { INPUTS, MINT1 } from '../_harness/fixtures';

const LOCK_KEY = `02${'a'.repeat(64)}`;
const LOCK_HEX = 'a'.repeat(64);

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

describe('lockableMintsFromRequest', () => {
  it('returns mints when the lock matches 02 + nostr pubkey', () => {
    expect(lockableMintsFromRequest(INPUTS.paymentRequestLocked, LOCK_HEX)).toEqual([
      MINT1,
    ]);
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
