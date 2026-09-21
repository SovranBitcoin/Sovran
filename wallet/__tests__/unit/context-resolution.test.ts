import { describe, it, expect } from 'vitest';
import { resolveFromContext } from '../../src/machine/contextResolution';
import { WALLETS, MINT1 } from '../_harness/fixtures';
import type { FlowContext } from '../../src/machine/types';

const DESTINATIONS: FlowContext[] = [
  { unit: 'sat', destination: 'sendEcash', mintUrl: MINT1 },
  { unit: 'sat', destination: 'mintQuote', mintUrl: MINT1 },
  { unit: 'sat', destination: 'receivePaymentRequest' },
  { unit: 'sat', destination: 'meltQuote', mintUrl: MINT1, meltTarget: 'user@example.com' },
];

describe('resolveFromContext — amount validation', () => {
  for (const base of DESTINATIONS) {
    const missing = resolveFromContext(base, WALLETS.default);

    it(`${base.destination}: a missing amount asks for one`, () => {
      expect(missing.step).toBe('enterAmount');
    });

    for (const amount of [NaN, 1.5, Infinity, -Infinity, 0, -5, Number.MAX_SAFE_INTEGER]) {
      it(`${base.destination}: ${amount} resolves exactly like a missing amount`, () => {
        const result = resolveFromContext({ ...base, amount }, WALLETS.default);
        expect(result.step).toBe('enterAmount');
        expect('data' in result ? result.data : undefined).toEqual(
          'data' in missing ? missing.data : undefined
        );
      });
    }

    it(`${base.destination}: a valid amount moves past amount entry`, () => {
      const result = resolveFromContext({ ...base, amount: 100 }, WALLETS.default);
      expect(result.step).not.toBe('enterAmount');
      expect(result.context.amount).toBe(100);
    });
  }
});
