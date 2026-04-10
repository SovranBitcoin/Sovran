/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * guards.ts — Intent Validation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Guards are the safety layer between intent resolution and flow execution.
 * After resolveIntent decides what the user wants to do, validateIntent
 * checks whether the wallet can actually do it.
 *
 * Each guard is a named check that returns { passed: boolean, reason? }.
 * The machine inspects guard results to decide:
 *   - All passed → proceed with the flow
 *   - Any failed → route to error step with the failure reason
 *
 * Guard types checked per intent:
 *
 *   receiveToken: No guards (receiving is always possible)
 *
 *   sendPaymentRequest:
 *     - mintSupport: Does the wallet trust a mint in the PR's mint list?
 *     - balance: Does any trusted mint have balance > 0?
 *     - balanceSufficient: Is the balance at matching mints >= PR amount?
 *     - httpTransport: Does the PR include an HTTP transport?
 *
 *   meltLightningInvoice:
 *     - balance: Does the wallet have any balance?
 *     - balanceSufficient: Is total balance >= invoice amount?
 *     - amountPresent: Does the invoice include an amount?
 *
 *   meltLightningAddress / meltLnurlp:
 *     - balance: Does the wallet have any balance?
 *     - amountRequired: Always fails (address/lnurl need user-entered amount)
 *
 *   chooseOption:
 *     - hasViableOption: Is at least one option not disabled?
 *
 *   ignore:
 *     - supported: Always fails (input not recognized)
 *
 * There are also two capability-checking functions:
 *   - checkWalletCapabilities: Given a set of UI capabilities (amountEntry,
 *     mintSelection, etc.) and an intent, are all required capabilities covered?
 *   - checkAllCapabilities: Across ALL intent types, what capabilities are missing?
 */

import { describe, it, expect } from 'vitest';
import { validateIntent, checkWalletCapabilities, checkAllCapabilities } from '../../src/guards';
import { WALLETS, MINT1, UNTRUSTED_MINT } from '../_harness/fixtures';
import type { ResolvedIntent, PaymentOption, WalletCapability } from '../../src/types';

/**
 * Helper to create a PaymentOption with optional amount. The amount field
 * is used by guards like balanceSufficient and amountPresent.
 */
function makeOption(kind: PaymentOption['kind'], value: string, amount?: number): PaymentOption {
  return { kind, value, amount, source: 'standalone' };
}

// ---------------------------------------------------------------------------
// validateIntent — receiveToken
// ---------------------------------------------------------------------------

/**
 * Receiving an ecash token requires nothing from the wallet — the token
 * IS the payment. No balance, no mints, no network. Therefore, receiveToken
 * has zero guards.
 */
describe('validateIntent — receiveToken', () => {
  it('produces no guards', () => {
    const intent: ResolvedIntent = { type: 'receiveToken', option: makeOption('ecashToken', 'tok') };
    const results = validateIntent(intent, WALLETS.default);
    // Empty array = all clear, proceed with the flow
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateIntent — sendPaymentRequest
// ---------------------------------------------------------------------------

/**
 * Payment requests are the most heavily guarded intent because they involve
 * sending ecash to a specific recipient via specific mints. Multiple things
 * can go wrong: the requested mint might not be trusted, balance might be
 * insufficient, or the transport might not be supported.
 */
describe('validateIntent — sendPaymentRequest', () => {
  it('passes mint support when trusted mint matches', () => {
    // PR targets MINT1, which is in WALLETS.default.trustedMintUrls → pass
    const intent: ResolvedIntent = {
      type: 'sendPaymentRequest',
      option: makeOption('paymentRequest', 'creq'),
      info: { mints: [MINT1], amount: 100, unit: 'sat' },
    };
    const results = validateIntent(intent, WALLETS.default);
    const mintGuard = results.find((r) => r.guard === 'mintSupport');
    expect(mintGuard?.passed).toBe(true);
  });

  it('fails mint support when no trusted mint matches', () => {
    // PR targets UNTRUSTED_MINT which the user hasn't added → fail.
    // The error code MINT_NOT_TRUSTED tells the UI what went wrong.
    const intent: ResolvedIntent = {
      type: 'sendPaymentRequest',
      option: makeOption('paymentRequest', 'creq'),
      info: { mints: [UNTRUSTED_MINT], amount: 100, unit: 'sat' },
    };
    const results = validateIntent(intent, WALLETS.default);
    const mintGuard = results.find((r) => r.guard === 'mintSupport');
    expect(mintGuard?.passed).toBe(false);
    expect(mintGuard?.reason?.code).toBe('MINT_NOT_TRUSTED');
  });

  it('skips mint support guard when no mints specified', () => {
    // PR with empty mints list means "any mint is fine" — no need to
    // check mint support. The guard is entirely skipped (not present).
    const intent: ResolvedIntent = {
      type: 'sendPaymentRequest',
      option: makeOption('paymentRequest', 'creq'),
      info: { mints: [], amount: 100, unit: 'sat' },
    };
    const results = validateIntent(intent, WALLETS.default);
    expect(results.find((r) => r.guard === 'mintSupport')).toBeUndefined();
  });

  it('passes balance guard when sufficient balance', () => {
    // WALLETS.default has 1000 at MINT1, PR wants 100 → pass
    const intent: ResolvedIntent = {
      type: 'sendPaymentRequest',
      option: makeOption('paymentRequest', 'creq'),
      info: { mints: [MINT1], amount: 100, unit: 'sat' },
    };
    const results = validateIntent(intent, WALLETS.default);
    const balanceGuard = results.find((r) => r.guard === 'balance');
    expect(balanceGuard?.passed).toBe(true);
  });

  it('fails balance guard when insufficient balance', () => {
    // PR requests 99999 sats, but total wallet balance is only 1500 → fail
    const intent: ResolvedIntent = {
      type: 'sendPaymentRequest',
      option: makeOption('paymentRequest', 'creq'),
      info: { mints: [MINT1], amount: 99999, unit: 'sat' },
    };
    const results = validateIntent(intent, WALLETS.default);
    const balanceGuard = results.find((r) => r.guard === 'balance');
    expect(balanceGuard?.passed).toBe(false);
    expect(balanceGuard?.reason?.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('checks http transport when transports are present', () => {
    // Payment requests can specify transport methods. This test verifies
    // the httpTransport guard recognizes a POST transport as valid.
    // HTTP transport is the most common method (Nostr transport is the other).
    const intent: ResolvedIntent = {
      type: 'sendPaymentRequest',
      option: makeOption('paymentRequest', 'creq'),
      info: {
        mints: [MINT1],
        amount: 100,
        unit: 'sat',
        transports: [{ type: 'post', target: 'https://example.com' }],
      },
    };
    const results = validateIntent(intent, WALLETS.default);
    const httpGuard = results.find((r) => r.guard === 'httpTransport');
    expect(httpGuard?.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateIntent — meltLightningInvoice
// ---------------------------------------------------------------------------

/**
 * Melting to a Lightning invoice (bolt11) requires:
 *   1. The wallet has some balance (any mint)
 *   2. The invoice has an encoded amount
 *   3. The wallet's total balance covers the invoice amount
 *
 * Each requirement maps to a separate guard so the UI can show
 * specific error messages (e.g. "invoice has no amount" vs "insufficient balance").
 */
describe('validateIntent — meltLightningInvoice', () => {
  it('passes balance guard when wallet has balance', () => {
    // WALLETS.default has 1500 total sats → pass
    const intent: ResolvedIntent = {
      type: 'meltLightningInvoice',
      option: makeOption('lightningInvoice', 'lnbc...', 100),
    };
    const results = validateIntent(intent, WALLETS.default);
    const guard = results.find((r) => r.guard === 'balance');
    expect(guard?.passed).toBe(true);
  });

  it('fails balance guard when wallet has no balance', () => {
    // WALLETS.noBalance has 0 sats → can't melt anything → fail
    const intent: ResolvedIntent = {
      type: 'meltLightningInvoice',
      option: makeOption('lightningInvoice', 'lnbc...', 100),
    };
    const results = validateIntent(intent, WALLETS.noBalance);
    const guard = results.find((r) => r.guard === 'balance');
    expect(guard?.passed).toBe(false);
    // NO_BALANCE is different from INSUFFICIENT_BALANCE — it means
    // the wallet has literally zero balance (not just "not enough")
    expect(guard?.reason?.code).toBe('NO_BALANCE');
  });

  it('checks balance sufficiency when amount is present', () => {
    // Invoice amount is 100, wallet has 1500 → sufficient → pass
    const intent: ResolvedIntent = {
      type: 'meltLightningInvoice',
      option: makeOption('lightningInvoice', 'lnbc...', 100),
    };
    const results = validateIntent(intent, WALLETS.default);
    const guard = results.find((r) => r.guard === 'balanceSufficient');
    expect(guard?.passed).toBe(true);
  });

  it('fails balance sufficiency when amount exceeds total', () => {
    // Invoice asks for 99999 sats, wallet only has 1500 → not sufficient
    const intent: ResolvedIntent = {
      type: 'meltLightningInvoice',
      option: makeOption('lightningInvoice', 'lnbc...', 99999),
    };
    const results = validateIntent(intent, WALLETS.default);
    const guard = results.find((r) => r.guard === 'balanceSufficient');
    expect(guard?.passed).toBe(false);
  });

  it('checks amount presence — passes when amount exists', () => {
    // The invoice includes an amount (100) → amountPresent passes
    const intent: ResolvedIntent = {
      type: 'meltLightningInvoice',
      option: makeOption('lightningInvoice', 'lnbc...', 100),
    };
    const results = validateIntent(intent, WALLETS.default);
    const guard = results.find((r) => r.guard === 'amountPresent');
    expect(guard?.passed).toBe(true);
  });

  it('checks amount presence — fails when no amount', () => {
    // Some bolt11 invoices have no encoded amount (zero-amount invoices).
    // We can't proceed without knowing how much to pay → fail.
    // The UI should tell the user this invoice type isn't supported.
    const intent: ResolvedIntent = {
      type: 'meltLightningInvoice',
      option: makeOption('lightningInvoice', 'lnbc...'),
    };
    const results = validateIntent(intent, WALLETS.default);
    const guard = results.find((r) => r.guard === 'amountPresent');
    expect(guard?.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateIntent — meltLightningAddress / meltLnurlp
// ---------------------------------------------------------------------------

/**
 * Lightning addresses and LNURL-pay endpoints are "amountless" — the user
 * must enter an amount before we can fetch an invoice. This means:
 *
 *   - balance guard: passes if wallet has any balance (same as invoice)
 *   - amountRequired guard: ALWAYS fails — we need the user to enter an
 *     amount. This isn't really an "error" but a signal to the machine
 *     that it needs to route to enterAmount step.
 *
 * Both address types share the same guard logic, so we test them together
 * with vitest's parameterized tests (it.each).
 */
describe('validateIntent — meltLightningAddress / meltLnurlp', () => {
  it.each(['meltLightningAddress', 'meltLnurlp'] as const)(
    '%s: passes balance, always fails amountRequired',
    (type) => {
      const option =
        type === 'meltLightningAddress'
          ? makeOption('lightningAddress', 'user@example.com')
          : makeOption('lnurlp', 'lnurlp://example.com');
      const intent = { type, option } as ResolvedIntent;
      const results = validateIntent(intent, WALLETS.default);

      // Balance guard passes — WALLETS.default has balance
      const balanceGuard = results.find((r) => r.guard === 'balance');
      expect(balanceGuard?.passed).toBe(true);

      // amountRequired ALWAYS fails — we need user input for the amount.
      // The machine uses this to know it must show the enterAmount step.
      const amountGuard = results.find((r) => r.guard === 'amountRequired');
      expect(amountGuard?.passed).toBe(false);
      expect(amountGuard?.reason?.code).toBe('NO_AMOUNT');
    }
  );
});

// ---------------------------------------------------------------------------
// validateIntent — chooseOption
// ---------------------------------------------------------------------------

/**
 * When the user is presented with multiple options (BIP-321 multi-option),
 * we need at least one usable option. If all options are disabled (e.g.
 * no balance for any of them), there's nothing the user can do → error.
 */
describe('validateIntent — chooseOption', () => {
  it('passes when at least one option is not disabled', () => {
    // One available + one disabled → at least one viable → pass
    const intent: ResolvedIntent = {
      type: 'chooseOption',
      options: [
        { option: makeOption('ecashToken', 'tok'), status: 'available', reason: null },
        { option: makeOption('lightningInvoice', 'ln'), status: 'disabled', reason: null },
      ],
    };
    const results = validateIntent(intent, WALLETS.default);
    const guard = results.find((r) => r.guard === 'hasViableOption');
    expect(guard?.passed).toBe(true);
  });

  it('fails when all options are disabled', () => {
    // Both disabled → no viable option → fail → machine routes to error
    const intent: ResolvedIntent = {
      type: 'chooseOption',
      options: [
        { option: makeOption('ecashToken', 'tok'), status: 'disabled', reason: null },
        { option: makeOption('lightningInvoice', 'ln'), status: 'disabled', reason: null },
      ],
    };
    const results = validateIntent(intent, WALLETS.default);
    const guard = results.find((r) => r.guard === 'hasViableOption');
    expect(guard?.passed).toBe(false);
    expect(guard?.reason?.code).toBe('ALL_OPTIONS_DISABLED');
  });
});

// ---------------------------------------------------------------------------
// validateIntent — ignore
// ---------------------------------------------------------------------------

/**
 * The 'ignore' intent means the input wasn't recognized as any supported
 * format. The 'supported' guard always fails with UNSUPPORTED_INPUT,
 * which causes the machine to route to the error step.
 */
describe('validateIntent — ignore', () => {
  it('always fails supported guard', () => {
    const intent: ResolvedIntent = {
      type: 'ignore',
      reason: { code: 'UNSUPPORTED_INPUT', message: 'Not supported' },
    };
    const results = validateIntent(intent, WALLETS.default);
    // Exactly one guard — 'supported' — and it always fails
    expect(results).toHaveLength(1);
    expect(results[0].guard).toBe('supported');
    expect(results[0].passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkWalletCapabilities
// ---------------------------------------------------------------------------

/**
 * checkWalletCapabilities verifies that the wallet app has registered
 * enough UI capabilities to handle a given intent. Each intent type
 * requires certain capabilities:
 *   - sendPaymentRequest needs: amountEntry, mintSelection, proofSelection, httpTransport
 *   - meltLightningInvoice needs: amountEntry, mintSelection, meltQuoteFetch
 *   - receiveToken needs: tokenReceive
 *   - etc.
 *
 * If the wallet hasn't registered a required capability, the check returns
 * covered=false with a list of missing capabilities. This allows coco-payment-ux
 * to warn at startup: "Your wallet doesn't support mint selection."
 */
describe('checkWalletCapabilities', () => {
  it('returns covered=true when all capabilities present', () => {
    // Provide all possible capabilities → everything is covered
    const caps = new Set<WalletCapability>([
      'amountEntry',
      'mintSelection',
      'proofSelection',
      'httpTransport',
    ]);
    const intent: ResolvedIntent = {
      type: 'sendPaymentRequest',
      option: makeOption('paymentRequest', 'creq'),
      info: { mints: [], amount: 100, unit: 'sat' },
    };
    const result = checkWalletCapabilities(caps, intent);
    expect(result.covered).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('returns missing capabilities', () => {
    // Only provide amountEntry — missing mintSelection for sendPaymentRequest
    const caps = new Set<WalletCapability>(['amountEntry']);
    const intent: ResolvedIntent = {
      type: 'sendPaymentRequest',
      option: makeOption('paymentRequest', 'creq'),
      info: { mints: [], amount: 100, unit: 'sat' },
    };
    const result = checkWalletCapabilities(caps, intent);
    expect(result.covered).toBe(false);
    // mintSelection is required for payment requests but not provided
    expect(result.missing).toContain('mintSelection');
  });
});

// ---------------------------------------------------------------------------
// checkAllCapabilities
// ---------------------------------------------------------------------------

/**
 * checkAllCapabilities is a comprehensive check — it verifies capabilities
 * across ALL possible intent types at once. This is useful at app startup
 * to identify any flows that won't work due to missing UI components.
 *
 * Returns an array of gaps: { intentType, missing[] } for each intent
 * type that has missing capabilities.
 */
describe('checkAllCapabilities', () => {
  it('returns empty when all capabilities covered', () => {
    // Provide every known capability — no gaps should exist
    const all = new Set<WalletCapability>([
      'tokenReceive',
      'amountEntry',
      'mintSelection',
      'proofSelection',
      'httpTransport',
      'meltQuoteFetch',
      'mintInfo',
      'profileView',
      'optionSelection',
    ]);
    const gaps = checkAllCapabilities(all);
    expect(gaps).toHaveLength(0);
  });

  it('reports gaps for missing capabilities', () => {
    // Only provide tokenReceive — most intent types will have gaps
    const partial = new Set<WalletCapability>(['tokenReceive']);
    const gaps = checkAllCapabilities(partial);
    expect(gaps.length).toBeGreaterThan(0);
    // sendPaymentRequest requires multiple capabilities we didn't provide
    expect(gaps.some((g) => g.intentType === 'sendPaymentRequest')).toBe(true);
  });
});
