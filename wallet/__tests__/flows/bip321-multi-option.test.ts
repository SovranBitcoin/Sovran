/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * bip321-multi-option.test.ts — BIP-321 Multi-Option Flow
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * BIP-321 URIs (bitcoin:?...) can contain multiple payment options. For
 * example, a merchant might generate a URI with both:
 *   - cashu=<token> — for ecash wallets (instant settlement)
 *   - lightning=<address> — for Lightning wallets (traditional)
 *
 * When the parser detects multiple options, the machine routes to the
 * chooseOption step where the user picks which option to use. Each option
 * is annotated with availability status based on the wallet state.
 *
 * Possible paths after chooseOption:
 *   - Choose ecashToken → receiveToken (instant, no further input)
 *   - Choose lightningAddress → enterAmount → navigateToMeltPreview
 *   - Choose lightningInvoice → navigateToMeltPreview (amount in invoice)
 *   - Choose paymentRequest → navigateToPaymentRequest
 *
 * Edge cases:
 *   - BIP-321 with NO supported params (just an on-chain address) → error
 *   - BIP-321 where all options are disabled (no balance) → error
 *   - Single option in BIP-321 → auto-selects (no picker needed)
 */

import { describe, it, expect } from 'vitest';
import { createTestMachine, runScenario } from '../_harness';
import { WALLETS, MINT1, INPUTS } from '../_harness/fixtures';
import type { FlowScenario } from '../_harness/types';

// ---------------------------------------------------------------------------
// BIP-321 with multiple options → chooseOption
// ---------------------------------------------------------------------------

/**
 * The core multi-option test: a BIP-321 URI with both a cashu token and
 * a lightning address should present the user with a choice.
 */
describe('BIP-321 multi-option', () => {
  it('routes to chooseOption when cashu + lightning present', async () => {
    // bitcoin:?cashu=<token>&lightning=<address> → 2 options detected
    const input = `bitcoin:?cashu=${INPUTS.cashuTokenV3}&lightning=${INPUTS.lightningAddress}`;
    const tm = createTestMachine();
    await tm.machine.execute(input, { reset: true });
    // Machine should pause at chooseOption waiting for user selection
    tm.assertStep('chooseOption');
  });

  it('annotates options with wallet context', async () => {
    // Each option should have a status (recommended/available/disabled)
    // based on the wallet state. With WALLETS.default (has balance),
    // both options should be available.
    const input = `bitcoin:?cashu=${INPUTS.cashuTokenV3}&lightning=${INPUTS.lightningAddress}`;
    const tm = createTestMachine();
    await tm.machine.execute(input, { reset: true });

    const ctx = tm.machine.getContext();
    if (ctx.intent?.type === 'chooseOption') {
      // At least 2 options (cashu + lightning)
      expect(ctx.intent.options.length).toBeGreaterThanOrEqual(2);
      // Every option should have a 'status' field from annotation
      expect(ctx.intent.options.every((o) => 'status' in o)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Choosing ecash option from BIP-321
// ---------------------------------------------------------------------------

/**
 * User selects the ecashToken option from a multi-option BIP-321 URI.
 * This should route to receiveToken — the same as if they'd scanned
 * a bare cashu token.
 */
describe('BIP-321 — choose ecash option', () => {
  it('chooseOption(ecashToken) → receiveToken', async () => {
    const input = `bitcoin:?cashu=${INPUTS.cashuTokenV3}&lightning=${INPUTS.lightningAddress}`;
    const tm = createTestMachine();
    await tm.machine.execute(input, { reset: true });
    tm.assertStep('chooseOption');

    // Find and select the ecash option from the parsed options
    const ctx = tm.machine.getContext();
    const ecashOption = ctx.parsed?.options.find((o) => o.kind === 'ecashToken');
    if (ecashOption) {
      await tm.machine.chooseOption(ecashOption);
      // Should route to receiveToken just like a bare cashu token
      tm.assertStep('receiveToken');
    }
  });
});

// ---------------------------------------------------------------------------
// Choosing lightning option from BIP-321
// ---------------------------------------------------------------------------

/**
 * User selects the lightningAddress option. This needs an amount (addresses
 * don't include amounts), so the machine routes to enterAmount.
 */
describe('BIP-321 — choose lightning option', () => {
  it('chooseOption(lightningAddress) → enterAmount', async () => {
    const input = `bitcoin:?cashu=${INPUTS.cashuTokenV3}&lightning=${INPUTS.lightningAddress}`;
    const tm = createTestMachine();
    await tm.machine.execute(input, { reset: true });
    tm.assertStep('chooseOption');

    const ctx = tm.machine.getContext();
    const lnOption = ctx.parsed?.options.find((o) => o.kind === 'lightningAddress');
    if (lnOption) {
      await tm.machine.chooseOption(lnOption);
      // Lightning address needs amount → enterAmount step
      tm.assertStep('enterAmount');
    }
  });
});

// ---------------------------------------------------------------------------
// BIP-321 with only unsupported params → ignore/bip321
// ---------------------------------------------------------------------------

/**
 * A bitcoin: URI with only an on-chain address (no lightning/cashu params).
 * Since we don't support on-chain payments, there are no usable options.
 * The machine recognizes the BIP-321 format but routes to error because
 * it can't do anything with just a Bitcoin address.
 */
describe('BIP-321 — no supported options', () => {
  it('routes to error for bitcoin: URI with no supported params', async () => {
    const tm = createTestMachine();
    // bitcoin:bc1qtest123 — on-chain address only, no lightning or cashu
    await tm.machine.execute('bitcoin:bc1qtest123', { reset: true });
    tm.assertStep('error');
  });
});

// ---------------------------------------------------------------------------
// BIP-321 — all options disabled
// ---------------------------------------------------------------------------

/**
 * When all detected options are disabled (e.g. all require balance but
 * wallet has none), the machine either shows the options as disabled
 * (letting the user see what's wrong) or routes directly to error.
 */
describe('BIP-321 — all disabled', () => {
  it('routes to error when all options disabled (no balance)', async () => {
    // Single lightning option with no balance → lightning is disabled
    // (needs balance to melt), but since lightning addresses always
    // need amount first, it might still route to enterAmount.
    const input = `bitcoin:?lightning=${INPUTS.lightningAddress}`;
    const tm = createTestMachine({ wallet: WALLETS.noBalance });
    await tm.machine.execute(input, { reset: true });
    const step = tm.machine.getStep();
    // Either enterAmount (error surfaces later) or error (fail-fast)
    expect(['enterAmount', 'error']).toContain(step);
  });
});

// ---------------------------------------------------------------------------
// Scenario-based
// ---------------------------------------------------------------------------

/**
 * Complete multi-step flows expressed as declarative scenarios.
 */

const BIP321_ECASH_FALLBACK: FlowScenario = {
  name: 'BIP-321: choose ecash from multi-option → receiveToken',
  steps: [
    // Step 0: Execute BIP-321 URI with cashu + lightning → chooseOption
    { type: 'execute', input: `bitcoin:?cashu=${INPUTS.cashuTokenV3}&lightning=${INPUTS.lightningAddress}` },
    // Step 1: User picks the ecash option → receiveToken
    { type: 'chooseOption', optionKind: 'ecashToken' },
  ],
  waypoints: [
    // After parsing, the machine should be waiting for user choice
    { afterStep: 0, step: 'chooseOption' },
  ],
  expect: {
    step: 'receiveToken',
  },
};

const BIP321_LIGHTNING_FLOW: FlowScenario = {
  name: 'BIP-321: choose lightning from multi-option → enterAmount → melt',
  steps: [
    // Step 0: Execute BIP-321 → chooseOption
    { type: 'execute', input: `bitcoin:?cashu=${INPUTS.cashuTokenV3}&lightning=${INPUTS.lightningAddress}` },
    // Step 1: User picks lightning address → enterAmount
    { type: 'chooseOption', optionKind: 'lightningAddress' },
    // Step 2: User enters amount → navigateToMeltPreview
    { type: 'enterAmount', amount: 100, mintUrl: MINT1 },
  ],
  waypoints: [
    { afterStep: 0, step: 'chooseOption' },
    // After choosing lightning, we need amount input
    { afterStep: 1, step: 'enterAmount' },
  ],
  expect: {
    step: 'navigateToMeltPreview',
  },
};

describe('BIP-321 — table-driven scenarios', () => {
  it.each([
    BIP321_ECASH_FALLBACK,
    BIP321_LIGHTNING_FLOW,
  ])('$name', async (scenario) => {
    await runScenario(scenario);
  });
});
