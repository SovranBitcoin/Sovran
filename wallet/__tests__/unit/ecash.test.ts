/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ecash.ts — canonical cashu token metadata decoder.
 */

import { describe, expect, it } from 'vitest';

import { decodeEcashTokenMetadata, isValidEcashToken } from '../../src/ecash';
import { INPUTS, MINT1 } from '../_harness/fixtures';

describe('decodeEcashTokenMetadata', () => {
  it('decodes amount, mint, and unit from a valid token', () => {
    const meta = decodeEcashTokenMetadata(INPUTS.cashuTokenV3);
    expect(meta).not.toBeNull();
    expect(meta!.amount).toBe(1);
    expect(meta!.mint).toBe(MINT1);
    expect(meta!.unit).toBe('sat');
    expect(meta!.p2pkPubkey).toBeNull();
  });

  it('returns null for non-token input', () => {
    expect(decodeEcashTokenMetadata(INPUTS.randomString)).toBeNull();
    expect(decodeEcashTokenMetadata('')).toBeNull();
  });
});

describe('isValidEcashToken', () => {
  it('is true for a valid token, false otherwise', () => {
    expect(isValidEcashToken(INPUTS.cashuTokenV3)).toBe(true);
    expect(isValidEcashToken(INPUTS.randomString)).toBe(false);
  });
});
