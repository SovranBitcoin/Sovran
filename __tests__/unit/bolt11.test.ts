/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * bolt11.ts — canonical bolt11 invoice decoder.
 */

import { describe, expect, it } from 'vitest';

import { decodeBolt11Invoice } from '../../src/bolt11';
import { INPUTS } from '../_harness/fixtures';

describe('decodeBolt11Invoice', () => {
  it('decodes amount (sats), expiry, and description', () => {
    const info = decodeBolt11Invoice(INPUTS.bolt11WithAmount);
    expect(info).not.toBeNull();
    expect(info!.amountSat).toBe(250000);
    expect(info!.expirySec).toBe(60);
    expect(info!.description).toBe('1 cup coffee');
    expect(typeof info!.timestampSec).toBe('number');
  });

  it('returns null for non-invoice input', () => {
    expect(decodeBolt11Invoice(INPUTS.randomString)).toBeNull();
    expect(decodeBolt11Invoice('')).toBeNull();
  });
});
