/**
 * ═══════════════════════════════════════════════════════════════════════════
 * suggestions.test.ts — Quick Send Suggestion Tests
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests for computeQuickSendSuggestions(), the pure function that generates
 * offline-composable quick send suggestions from available proof amounts.
 *
 * The function:
 *   1. Takes proof amounts, BTC price, and optional fiat/config settings
 *   2. Tries composing each fiat and sat target from the available proofs
 *   3. Picks an evenly distributed subset from each category
 *   4. Returns sorted suggestions guaranteed to be offline-composable
 */

import { describe, it, expect } from 'vitest';
import { computeQuickSendSuggestions } from '../../src/amount-actions/suggestions';
import { composeSatoshis } from '../../src/offline';
import { WALLETS, MINT1 } from '../_harness/fixtures';

// ---------------------------------------------------------------------------
// Proof sets
// ---------------------------------------------------------------------------

/** Power-of-2 proofs: can compose any amount 1-1023 */
const DEFAULT_PROOFS = WALLETS.default.proofAmounts[MINT1]; // [1,2,4,8,16,32,64,128,256,512]

/** Gapped proofs: [512,256,128,64,32,8] — missing 1,2,4,16 */
const GAPPED_PROOFS = WALLETS.noExactProofs.proofAmounts[MINT1];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeQuickSendSuggestions', () => {
  it('returns empty for empty proofs', () => {
    const result = computeQuickSendSuggestions([], 100_000);
    expect(result).toEqual([]);
  });

  it('returns sat-only suggestions when no fiat info provided', () => {
    const result = computeQuickSendSuggestions(DEFAULT_PROOFS, 100_000);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((s) => s.inputMode === 'sat')).toBe(true);
  });

  it('returns both fiat and sat suggestions when fiat info provided', () => {
    const result = computeQuickSendSuggestions(DEFAULT_PROOFS, 100_000, {
      fiatCurrency: 'usd',
      fiatSymbol: '$',
    });
    expect(result.length).toBeGreaterThan(0);
    const hasFiat = result.some((s) => s.inputMode === 'fiat');
    const hasSat = result.some((s) => s.inputMode === 'sat');
    expect(hasFiat).toBe(true);
    expect(hasSat).toBe(true);
  });

  it('all suggestions are sorted ascending by satoshis', () => {
    const result = computeQuickSendSuggestions(DEFAULT_PROOFS, 100_000, {
      fiatCurrency: 'usd',
      fiatSymbol: '$',
    });
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.satoshis).toBeGreaterThanOrEqual(result[i - 1]!.satoshis);
    }
  });

  it('every suggestion is offline-composable', () => {
    const result = computeQuickSendSuggestions(DEFAULT_PROOFS, 100_000, {
      fiatCurrency: 'usd',
      fiatSymbol: '$',
    });
    for (const suggestion of result) {
      const composition = composeSatoshis(DEFAULT_PROOFS, suggestion.satoshis);
      expect(composition.exactMatch).toBe(true);
    }
  });

  it('no duplicate satoshi values', () => {
    const result = computeQuickSendSuggestions(DEFAULT_PROOFS, 100_000, {
      fiatCurrency: 'usd',
      fiatSymbol: '$',
    });
    const sats = result.map((s) => s.satoshis);
    expect(new Set(sats).size).toBe(sats.length);
  });

  it('respects custom limit per category', () => {
    const result = computeQuickSendSuggestions(DEFAULT_PROOFS, 100_000, {
      fiatCurrency: 'usd',
      fiatSymbol: '$',
      config: { limit: 1 },
    });
    const fiatCount = result.filter((s) => s.inputMode === 'fiat').length;
    const satCount = result.filter((s) => s.inputMode === 'sat').length;
    expect(fiatCount).toBeLessThanOrEqual(1);
    expect(satCount).toBeLessThanOrEqual(1);
  });

  it('respects custom targets', () => {
    const result = computeQuickSendSuggestions(DEFAULT_PROOFS, 100_000, {
      fiatCurrency: 'usd',
      fiatSymbol: '$',
      config: { fiatTargets: [1], satTargets: [21] },
    });
    const satSuggestions = result.filter((s) => s.inputMode === 'sat');
    if (satSuggestions.length > 0) {
      expect(satSuggestions[0]!.satoshis).toBe(21);
    }
  });

  it('handles high BTC price (low sat values per fiat dollar)', () => {
    // At $1,000,000/BTC, $1 = 100 sats
    const result = computeQuickSendSuggestions(DEFAULT_PROOFS, 1_000_000, {
      fiatCurrency: 'usd',
      fiatSymbol: '$',
    });
    expect(result.length).toBeGreaterThan(0);
    for (const s of result) {
      expect(s.satoshis).toBeLessThanOrEqual(1023); // total balance
    }
  });

  it('handles low BTC price (high sat values, many fiat targets exceed balance)', () => {
    // At $1,000/BTC, $1 = 100,000 sats — most fiat targets exceed 1023 balance
    const result = computeQuickSendSuggestions(DEFAULT_PROOFS, 1_000, {
      fiatCurrency: 'usd',
      fiatSymbol: '$',
    });
    // Fiat suggestions may be empty since even $0.10 = 10,000 sats > 1023
    // But sat suggestions should still exist
    const satSuggestions = result.filter((s) => s.inputMode === 'sat');
    expect(satSuggestions.length).toBeGreaterThan(0);
  });

  it('gapped proofs only suggest composable amounts', () => {
    const result = computeQuickSendSuggestions(GAPPED_PROOFS, 100_000, {
      fiatCurrency: 'usd',
      fiatSymbol: '$',
    });
    for (const suggestion of result) {
      const composition = composeSatoshis(GAPPED_PROOFS, suggestion.satoshis);
      expect(composition.exactMatch).toBe(true);
    }
  });
});
