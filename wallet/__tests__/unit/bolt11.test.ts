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

  it('rounds sub-sat (msat) precision UP to whole sats (BTC-10)', () => {
    // 1100 msat = 1.1 sats — before the fix this produced 1.1, failed the
    // machine's integer-only validator, and the fixed invoice silently
    // degraded to "amountless" (user typed a display-only amount while the
    // invoice's own amount was charged). Rounding up is the payer-safe
    // direction: approve slightly more, never less than the true cost.
    const info = decodeBolt11Invoice(INPUTS.bolt11MsatPrecision);
    expect(info).not.toBeNull();
    expect(info!.amountSat).toBe(2);
    expect(Number.isSafeInteger(info!.amountSat)).toBe(true);
  });
});
