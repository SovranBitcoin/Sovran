/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * annotate.ts — Option Annotation Rules
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * When the user scans a BIP-321 URI with multiple payment options (e.g.
 * both a cashu token and a lightning invoice), the UI needs to show which
 * options are usable, which are disabled, and which one to recommend.
 *
 * annotateOptions takes raw PaymentOption[] and applies rule sets based on
 * the option kind and the user's wallet state. The output is AnnotatedOption[]
 * with three possible statuses:
 *
 *   'recommended' — Best choice given the wallet state. Highlighted in UI.
 *   'available'   — Usable but not the top pick.
 *   'disabled'    — Can't be used (e.g. no balance). Greyed out in UI.
 *
 * Rule sets:
 *   - ecashToken: No rules — always available (receiving tokens requires
 *     no balance or mints). Gets promoted to 'recommended' if it's the
 *     only available option.
 *   - lightningInvoice/lightningAddress/lnurlp: LIGHTNING_RULES — checks
 *     wallet has balance > 0 (melting ecash to Lightning requires funds).
 *   - paymentRequest: PAYMENT_REQUEST_RULES — checks matching trusted mint
 *     and sufficient balance at that mint.
 *
 * After applying rules, annotateOptions:
 *   1. Sorts: recommended > available > disabled
 *   2. Promotes: if no option is naturally 'recommended', the first
 *      'available' option gets promoted to 'recommended'
 */

import { describe, it, expect } from 'vitest';
import { annotateOptions } from '../../src/annotate';
import { defaultDetectors } from '../../src/detectors';
import { WALLETS, MINT1, MINT2, UNTRUSTED_MINT } from '../_harness/fixtures';
import type { PaymentOption, WalletContext } from '../../src/types';

/**
 * Helper to create a minimal PaymentOption for testing. The `source`
 * field indicates where the option came from — 'standalone' means it
 * was the only thing in the input (not from a BIP-321 container).
 */
function makeOption(kind: PaymentOption['kind'], value: string): PaymentOption {
  return { kind, value, source: 'standalone' };
}

// ---------------------------------------------------------------------------
// ecashToken — no rules defined, always 'available'
// ---------------------------------------------------------------------------

/**
 * Ecash tokens have no annotation rules because receiving a token is
 * always possible — you don't need balance, trusted mints, or network
 * connectivity. The token contains the ecash itself.
 *
 * Because there are no rules to evaluate, ecashToken starts as 'available'.
 * If it's the only option (or the only available one), the promotion step
 * upgrades it to 'recommended'.
 */
describe('annotateOptions — ecashToken', () => {
  it('marks ecash token as available (no rules)', () => {
    const options = [makeOption('ecashToken', 'cashuAtoken...')];
    const result = annotateOptions(options, WALLETS.default, defaultDetectors);
    expect(result).toHaveLength(1);
    // ecashToken has no rules → defaults to 'available', then gets promoted
    // to 'recommended' because it's the only option
    expect(result[0].status).toBe('recommended');
    // No reason to disable — reason should be null
    expect(result[0].reason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Lightning options — use LIGHTNING_RULES
// ---------------------------------------------------------------------------

/**
 * Lightning payments (invoices, addresses, lnurlp) require the wallet to
 * "melt" ecash — convert it to a Lightning payment. This requires balance.
 *
 * LIGHTNING_RULES check:
 *   - Does the wallet have any balance > 0?
 *   - If no → status: 'disabled', reason: no balance
 *   - If yes → status: 'available' (promoted to 'recommended' if first)
 */
describe('annotateOptions — lightning', () => {
  it('marks lightning invoice as available when wallet has balance', () => {
    // WALLETS.default has 1000 + 500 sats across two mints → has balance
    const options = [makeOption('lightningInvoice', 'lnbc1...')];
    const result = annotateOptions(options, WALLETS.default, defaultDetectors);
    // Promoted from 'available' to 'recommended' (only option)
    expect(result[0].status).toBe('recommended');
  });

  it('marks lightning invoice as disabled when wallet has no balance', () => {
    // WALLETS.noBalance has MINT1 with 0 sats — can't melt to Lightning
    const options = [makeOption('lightningInvoice', 'lnbc1...')];
    const result = annotateOptions(options, WALLETS.noBalance, defaultDetectors);
    expect(result[0].status).toBe('disabled');
    // Should have a reason explaining why (e.g. NO_BALANCE)
    expect(result[0].reason).toBeTruthy();
  });

  it('marks lightning address as available with balance', () => {
    // Lightning addresses follow the same rules as invoices
    const options = [makeOption('lightningAddress', 'user@example.com')];
    const result = annotateOptions(options, WALLETS.default, defaultDetectors);
    expect(result[0].status).toBe('recommended');
  });

  it('marks lnurlp as disabled with no balance', () => {
    // LNURL-pay also requires balance (it resolves to a Lightning invoice)
    const options = [makeOption('lnurlp', 'lnurlp://example.com')];
    const result = annotateOptions(options, WALLETS.noBalance, defaultDetectors);
    expect(result[0].status).toBe('disabled');
  });
});

// ---------------------------------------------------------------------------
// Sorting and promotion
// ---------------------------------------------------------------------------

/**
 * After applying rules, annotateOptions sorts and promotes options:
 *
 * SORTING ORDER: recommended → available → disabled
 * This ensures the UI always shows the best option first.
 *
 * PROMOTION RULE: If no option is naturally 'recommended' (i.e. no rule
 * explicitly sets recommended), the first 'available' option gets promoted
 * to 'recommended'. This ensures the UI always has a highlighted default.
 *
 * The promotion rule does NOT fire when a 'recommended' option already
 * exists — this prevents two options from being recommended simultaneously.
 */
describe('annotateOptions — sorting and promotion', () => {
  it('sorts: recommended first, then available, then disabled', () => {
    const options = [
      makeOption('lightningInvoice', 'lnbc1...'),
      makeOption('ecashToken', 'cashuAtoken...'),
    ];
    const result = annotateOptions(options, WALLETS.default, defaultDetectors);
    const statuses = result.map((a) => a.status);
    // Map statuses to sort order values: recommended=0, available=1, disabled=2
    const order = statuses.map((s) =>
      s === 'recommended' ? 0 : s === 'available' ? 1 : 2
    );
    // Each status should be >= the previous (non-decreasing order)
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThanOrEqual(order[i - 1]);
    }
  });

  it('promotes first available to recommended when none naturally recommended', () => {
    // Both lightning and ecash with balance — neither has a natural
    // 'recommended' rule, so the first available option gets promoted
    const options = [
      makeOption('lightningInvoice', 'lnbc1...'),
      makeOption('ecashToken', 'cashuAtoken...'),
    ];
    const result = annotateOptions(options, WALLETS.default, defaultDetectors);
    const recommended = result.filter((a) => a.status === 'recommended');
    // At least one should be promoted to recommended
    expect(recommended.length).toBeGreaterThanOrEqual(1);
  });

  it('does not promote when a naturally recommended option exists', () => {
    // Payment requests with matching trusted mint + sufficient balance
    // are naturally 'recommended' by PAYMENT_REQUEST_RULES. When one
    // exists, other options should NOT be promoted — only one recommended.
    const prOption = makeOption('paymentRequest', 'fake_creq_for_test');

    // Custom detectors that return MINT1 as the payment request's mint
    // with amount=100 (within WALLETS.default balance of 1000 at MINT1)
    const detectors = {
      ...defaultDetectors,
      getPaymentRequestInfo: () => ({
        mints: [MINT1],
        amount: 100,
        unit: 'sat',
      }),
    };

    const lnOption = makeOption('lightningAddress', 'user@example.com');
    const result = annotateOptions([prOption, lnOption], WALLETS.default, detectors);

    const recommended = result.filter((a) => a.status === 'recommended');
    // Exactly one recommended — the payment request
    expect(recommended.length).toBe(1);
    expect(recommended[0].option.kind).toBe('paymentRequest');
  });
});

// ---------------------------------------------------------------------------
// Payment request annotation rules
// ---------------------------------------------------------------------------

/**
 * PAYMENT_REQUEST_RULES are the most complex annotation rules. They check:
 *
 *   1. MINT SUPPORT: Does the user trust at least one mint specified in
 *      the payment request? If the PR lists mints and none are trusted,
 *      the option is disabled with MINT_NOT_TRUSTED.
 *
 *   2. BALANCE: Does the trusted mint have enough balance for the PR amount?
 *      If not, disabled with INSUFFICIENT_BALANCE.
 *
 *   3. NO MINTS SPECIFIED: If the PR doesn't specify mints (mints: []),
 *      any trusted mint can fulfill it — recommended if balance is sufficient.
 *
 * A payment request that passes all rules gets status: 'recommended'
 * (not just 'available') because it's the most specific option — it was
 * created specifically for this payment.
 */
describe('annotateOptions — paymentRequest rules', () => {
  const prOption = makeOption('paymentRequest', 'creq_test');

  it('recommends when matching trusted mint has sufficient balance', () => {
    // PR targets MINT1 (amount=100). WALLETS.default trusts MINT1 with
    // 1000 sat balance. All rules pass → recommended.
    const detectors = {
      ...defaultDetectors,
      getPaymentRequestInfo: () => ({
        mints: [MINT1],
        amount: 100,
        unit: 'sat',
      }),
    };
    const result = annotateOptions([prOption], WALLETS.default, detectors);
    expect(result[0].status).toBe('recommended');
  });

  it('disables when no trusted mint matches', () => {
    // PR targets UNTRUSTED_MINT which is not in WALLETS.default.trustedMintUrls.
    // The user hasn't added this mint → can't pay via this mint → disabled.
    const detectors = {
      ...defaultDetectors,
      getPaymentRequestInfo: () => ({
        mints: [UNTRUSTED_MINT],
        amount: 100,
        unit: 'sat',
      }),
    };
    const result = annotateOptions([prOption], WALLETS.default, detectors);
    expect(result[0].status).toBe('disabled');
  });

  it('disables when balance is insufficient', () => {
    // PR targets MINT1 (trusted) but requests 99999 sats — way more than
    // the 1000 sat balance at MINT1. Balance check fails → disabled.
    const detectors = {
      ...defaultDetectors,
      getPaymentRequestInfo: () => ({
        mints: [MINT1],
        amount: 99999, // more than WALLETS.default balance
        unit: 'sat',
      }),
    };
    const result = annotateOptions([prOption], WALLETS.default, detectors);
    expect(result[0].status).toBe('disabled');
  });

  it('recommends when no mints specified (any trusted mint works)', () => {
    // PR has empty mints list — this means "any mint is fine."
    // The wallet trusts MINT1 and MINT2, and has balance → recommended.
    const detectors = {
      ...defaultDetectors,
      getPaymentRequestInfo: () => ({
        mints: [],
        amount: 100,
        unit: 'sat',
      }),
    };
    const result = annotateOptions([prOption], WALLETS.default, detectors);
    expect(result[0].status).toBe('recommended');
  });
});
