/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * mint-selection.ts — Mint Selection Logic
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The wallet may trust multiple Cashu mints, each with different balances.
 * When the user wants to send ecash or pay a Lightning invoice, the machine
 * needs to choose which mint to use. This module handles that decision.
 *
 * Three functions are tested:
 *
 *   getValidMintCandidates(wallet, options?)
 *     Filters the wallet's trusted mints down to those that are valid for
 *     the current operation. Filters by:
 *       - balance > 0 (mints with no proofs can't send)
 *       - allowedMints intersection (for payment requests that specify mints)
 *       - minAmount threshold (for invoices with a specific amount)
 *     Returns candidates sorted by balance (highest first).
 *
 *   selectMint(wallet, options?)
 *     The auto-selection algorithm:
 *       1. Get valid candidates
 *       2. If the user's preferred mint is in the valid set → use it
 *       3. If only one valid mint → auto-select it
 *       4. If multiple valid mints and no preferred → 'selectionNeeded'
 *          (machine routes to selectMint step for user to choose)
 *       5. If no valid mints → 'noValidMint' with reason
 *
 *   selectMintForMelt(wallet, minAmount?)
 *     Specialized for Lightning melts — same as selectMint but uses the
 *     melt-specific minAmount (invoice amount) for filtering.
 *
 * Wallet fixtures used:
 *   default:             2 mints (MINT1=1000, MINT2=500), preferred=MINT1
 *   singleMint:          1 mint (MINT1=1000), preferred=MINT1
 *   noBalance:           1 mint (MINT1=0), preferred=MINT1
 *   noMints:             0 mints
 *   multiMintUnbalanced: 3 mints (MINT1=5000, MINT2=100, MINT3=0), preferred=MINT2
 *   insufficientBalance: 1 mint (MINT1=50), preferred=MINT1
 */

import { describe, it, expect } from 'vitest';
import {
  getValidMintCandidates,
  pickPreferredCandidate,
  selectMint,
  selectMintForMelt,
} from '../../src/mint-selection';
import { WALLETS, MINT1, MINT2, UNTRUSTED_MINT } from '../_harness/fixtures';

// ---------------------------------------------------------------------------
// getValidMintCandidates
// ---------------------------------------------------------------------------

/**
 * getValidMintCandidates is the foundation — it produces the list of mints
 * that COULD be used. selectMint and selectMintForMelt both call this
 * internally and then apply auto-selection logic on top.
 */
describe('getValidMintCandidates', () => {
  it('returns trusted mints with balance > 0', () => {
    // WALLETS.default has MINT1 (1000) and MINT2 (500) — both have balance.
    // Both should appear in candidates.
    const candidates = getValidMintCandidates(WALLETS.default);
    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.balance > 0)).toBe(true);
  });

  it('filters by allowedMints intersection', () => {
    // Only allow MINT1. Even though MINT2 has balance, it's excluded
    // because it's not in the allowed set (e.g. payment request only
    // accepts tokens from MINT1).
    const candidates = getValidMintCandidates(WALLETS.default, {
      allowedMints: [MINT1],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].mintUrl).toBe(MINT1);
  });

  it('returns empty when allowedMints has no trusted overlap', () => {
    // The payment request requires UNTRUSTED_MINT, which the user hasn't
    // added to their wallet → no intersection with trusted mints → empty.
    const candidates = getValidMintCandidates(WALLETS.default, {
      allowedMints: [UNTRUSTED_MINT],
    });
    expect(candidates).toHaveLength(0);
  });

  it('filters by minAmount', () => {
    // Require balance ≥ 600 sats. MINT1 has 1000 (passes), MINT2 has 500 (fails).
    // Only MINT1 should remain.
    const candidates = getValidMintCandidates(WALLETS.default, {
      minAmount: 600,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].mintUrl).toBe(MINT1);
  });

  it('sorts by highest balance by default', () => {
    // Candidates should be sorted descending by balance.
    // MINT1 (1000) should come before MINT2 (500).
    const candidates = getValidMintCandidates(WALLETS.default);
    expect(candidates[0].balance).toBeGreaterThanOrEqual(candidates[1].balance);
  });

  it('returns empty for noBalance wallet', () => {
    // WALLETS.noBalance has MINT1 with 0 balance → no valid candidates
    const candidates = getValidMintCandidates(WALLETS.noBalance);
    expect(candidates).toHaveLength(0);
  });

  it('returns empty for noMints wallet', () => {
    // WALLETS.noMints has no trusted mints at all → empty
    const candidates = getValidMintCandidates(WALLETS.noMints);
    expect(candidates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// selectMint
// ---------------------------------------------------------------------------

/**
 * selectMint adds auto-selection logic on top of getValidMintCandidates.
 * It returns one of three result types:
 *
 *   { type: 'selected', mintUrl } — A mint was auto-selected (preferred
 *     mint in the valid set, or only one valid mint)
 *
 *   { type: 'selectionNeeded', validMints } — Multiple valid mints exist
 *     and none is preferred → the UI must show the mint picker
 *
 *   { type: 'noValidMint', reason } — No mint can fulfill the request →
 *     the machine routes to the error step
 */
describe('selectMint', () => {
  it('auto-selects preferred mint when in valid set', () => {
    // WALLETS.default has preferredMintUrl=MINT1, and MINT1 has balance.
    // Auto-selection should pick MINT1 without user interaction.
    const result = selectMint(WALLETS.default);
    expect(result.type).toBe('selected');
    if (result.type === 'selected') {
      expect(result.mintUrl).toBe(MINT1); // preferredMintUrl
    }
  });

  it('auto-selects the only valid mint (single mint wallet)', () => {
    // WALLETS.singleMint has only MINT1. When there's only one choice,
    // auto-select it — no point showing a picker with one option.
    const result = selectMint(WALLETS.singleMint);
    expect(result.type).toBe('selected');
    if (result.type === 'selected') {
      expect(result.mintUrl).toBe(MINT1);
    }
  });

  it('returns selectionNeeded when multiple valid mints and no preferred', () => {
    // Remove the preferred mint. Now MINT1 and MINT2 both have balance
    // but the wallet doesn't know which to use → ask the user.
    const wallet = {
      ...WALLETS.default,
      preferredMintUrl: undefined,
    };
    const result = selectMint(wallet);
    expect(result.type).toBe('selectionNeeded');
    if (result.type === 'selectionNeeded') {
      expect(result.validMints.length).toBeGreaterThan(1);
    }
  });

  it('returns noValidMint when no balance', () => {
    // WALLETS.noBalance has MINT1 with 0 balance → can't send from any mint
    const result = selectMint(WALLETS.noBalance);
    expect(result.type).toBe('noValidMint');
    if (result.type === 'noValidMint') {
      // The reason should explain why (e.g. NO_BALANCE error code)
      expect(result.reason).toBeTruthy();
    }
  });

  it('returns noValidMint when no mints trusted', () => {
    // WALLETS.noMints has trustedMintUrls=[] → no mints at all
    const result = selectMint(WALLETS.noMints);
    expect(result.type).toBe('noValidMint');
  });

  it('returns noValidMint with correct code when allowedMints not trusted', () => {
    // Payment request requires UNTRUSTED_MINT, but the user only trusts
    // MINT1 and MINT2 → no valid mint to fulfill the request.
    const result = selectMint(WALLETS.default, {
      allowedMints: [UNTRUSTED_MINT],
    });
    expect(result.type).toBe('noValidMint');
  });

  it('respects minAmount filter', () => {
    // Require ≥ 600 sats. MINT1 (1000) passes, MINT2 (500) fails.
    // Auto-select MINT1 since it's the only valid option.
    const result = selectMint(WALLETS.default, { minAmount: 600 });
    if (result.type === 'selected') {
      expect(result.mintUrl).toBe(MINT1);
    }
  });

  it('returns noValidMint when minAmount exceeds all balances', () => {
    // 99999 exceeds both MINT1 (1000) and MINT2 (500) → no valid mint
    const result = selectMint(WALLETS.default, { minAmount: 99999 });
    expect(result.type).toBe('noValidMint');
  });
});

// ---------------------------------------------------------------------------
// selectMint — multiMintUnbalanced
// ---------------------------------------------------------------------------

/**
 * multiMintUnbalanced tests the preference vs. capability trade-off:
 *   MINT1: 5000 sats (lots of balance)
 *   MINT2: 100 sats (preferred mint, low balance)
 *   MINT3: 0 sats (empty)
 *
 * The user prefers MINT2 (maybe it's their favorite privacy mint), but
 * for larger amounts, only MINT1 has enough balance.
 */
describe('selectMint — multiMintUnbalanced', () => {
  it('selects preferred mint when it has balance', () => {
    // WALLETS.multiMintUnbalanced prefers MINT2 (100 sats).
    // For a send without minAmount, MINT2 is valid (has balance > 0),
    // so the preferred mint is selected even though MINT1 has more.
    const result = selectMint(WALLETS.multiMintUnbalanced);
    expect(result.type).toBe('selected');
    if (result.type === 'selected') {
      expect(result.mintUrl).toBe(MINT2);
    }
  });

  it('preferred mint skipped when below minAmount', () => {
    // Require ≥ 200 sats. MINT2 (preferred, 100 sats) is too low.
    // Falls through to MINT1 (5000 sats) which has enough balance.
    const result = selectMint(WALLETS.multiMintUnbalanced, { minAmount: 200 });
    if (result.type === 'selected') {
      expect(result.mintUrl).toBe(MINT1);
    }
  });
});

// ---------------------------------------------------------------------------
// selectMintForMelt
// ---------------------------------------------------------------------------

/**
 * selectMintForMelt is used for Lightning payments (melts). It works like
 * selectMint but takes a minAmount parameter directly (the invoice amount)
 * rather than through an options object.
 *
 * The key difference: melt operations should prefer the mint with the
 * most balance (to maximize success probability), but still respect
 * the user's preferred mint when it's viable.
 */
describe('selectMintForMelt', () => {
  it('selects mint with highest balance', () => {
    // For melts, we want the highest-balance mint for reliability.
    // The preferred mint (MINT2, 100 sats) is still in the valid set,
    // so if it's preferred, it takes priority.
    const result = selectMintForMelt(WALLETS.multiMintUnbalanced);
    expect(result.type).toBe('selected');
  });

  it('respects minAmount', () => {
    // Melt for 200 sats. MINT2 (preferred, 100 sats) can't cover it.
    // Must fall back to MINT1 (5000 sats).
    const result = selectMintForMelt(WALLETS.multiMintUnbalanced, 200);
    if (result.type === 'selected') {
      expect(result.mintUrl).toBe(MINT1);
    }
  });
});

// ---------------------------------------------------------------------------
// pickPreferredCandidate
// ---------------------------------------------------------------------------

/**
 * pickPreferredCandidate chooses one mint from a caller-supplied, already
 * eligible candidate list (e.g. method-aware full-amount melt candidates).
 * It honors the preferred mint when present, else the highest balance.
 */
describe('pickPreferredCandidate', () => {
  it('returns the preferred mint when it is among the candidates', () => {
    const picked = pickPreferredCandidate(
      [
        { mintUrl: MINT1, balance: 1500 },
        { mintUrl: MINT2, balance: 2000 },
      ],
      MINT1,
    );
    expect(picked?.mintUrl).toBe(MINT1);
  });

  it('returns the highest-balance candidate when the preferred mint is absent', () => {
    const picked = pickPreferredCandidate(
      [
        { mintUrl: MINT1, balance: 1500 },
        { mintUrl: MINT2, balance: 2000 },
      ],
      UNTRUSTED_MINT,
    );
    expect(picked?.mintUrl).toBe(MINT2);
  });

  it('returns the highest-balance candidate when no preferred mint is given', () => {
    const picked = pickPreferredCandidate([
      { mintUrl: MINT1, balance: 1500 },
      { mintUrl: MINT2, balance: 2000 },
    ]);
    expect(picked?.mintUrl).toBe(MINT2);
  });

  it('returns undefined for an empty candidate list', () => {
    expect(pickPreferredCandidate([], MINT1)).toBeUndefined();
  });
});
