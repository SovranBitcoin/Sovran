/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * mint-quote.test.ts — Mint Quote (Receive Lightning) Flow
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Mint quote" is the process of receiving Bitcoin via Lightning and
 * converting it to ecash tokens. The user:
 *   1. Taps "Receive" → "Lightning"
 *   2. Enters how much they want to receive
 *   3. Selects which mint should create the quote
 *   4. The mint returns a Lightning invoice for the amount
 *   5. After someone pays the invoice, the mint issues ecash tokens
 *
 * This is the inverse of melting: melt converts ecash → Lightning,
 * mint quote converts Lightning → ecash.
 *
 * Flow: startReceiveLightning → enterAmount → createMintQuote → mintQuoteCreated
 *
 * IMPORTANT: createMintQuote is an AUTO-EXECUTION step. When the machine
 * reaches it, the wrapper automatically calls executeMintQuote() and
 * transitions to mintQuoteCreated. In tests using createTestMachine,
 * you'll see mintQuoteCreated (not createMintQuote) as the final step.
 *
 * Unlike sending, receiving via Lightning works with zero balance —
 * you're adding balance, not spending it. The only requirement is a
 * trusted mint to create the quote.
 */

import { describe, it, expect } from 'vitest';
import { createTestMachine, runScenario } from '../_harness';
import { WALLETS, MINT1, MINT2 } from '../_harness/fixtures';
import type { FlowScenario } from '../_harness/types';

// ---------------------------------------------------------------------------
// startReceiveLightning — direct entry
// ---------------------------------------------------------------------------

/**
 * startReceiveLightning() is called when the user navigates to
 * Receive → Lightning. It sets up the mint quote flow context.
 */
describe('mint quote — startReceiveLightning', () => {
  it('routes to enterAmount with preferred mint', async () => {
    // The preferred mint (MINT1) is auto-selected for the quote.
    // destination='mintQuote' tells the machine this is a receive flow.
    const tm = createTestMachine();
    await tm.machine.startReceiveLightning();
    tm.assertStep('enterAmount');
    tm.assertContext({ destination: 'mintQuote', mintUrl: MINT1 });
  });

  it('falls back to first trusted mint when no preferred', async () => {
    // If the user has no preferred mint, the machine picks the first
    // trusted mint that's available for quotes.
    const tm = createTestMachine({
      wallet: { ...WALLETS.default, preferredMintUrl: undefined },
    });
    await tm.machine.startReceiveLightning();
    tm.assertStep('enterAmount');
    // Should use some trusted mint (not undefined)
    const ctx = tm.machine.getContext();
    expect(ctx.mintUrl).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Full mint quote flow
// ---------------------------------------------------------------------------

const MINT_QUOTE_HAPPY: FlowScenario = {
  name: 'mint quote: startReceiveLightning → enterAmount → mintQuoteCreated',
  steps: [
    // Step 0: Start receive flow → enterAmount with MINT1 pre-selected
    { type: 'startReceiveLightning' },
    // Step 1: User enters 1000 sats → createMintQuote auto-executes → mintQuoteCreated
    { type: 'enterAmount', amount: 1000, mintUrl: MINT1 },
  ],
  waypoints: [
    // After starting, we should be waiting for amount input
    { afterStep: 0, step: 'enterAmount' },
  ],
  expect: {
    // createMintQuote auto-resolves to mintQuoteCreated
    step: 'mintQuoteCreated',
    context: { amount: 1000, mintUrl: MINT1, destination: 'mintQuote' },
  },
};

const MINT_QUOTE_CHANGE_MINT: FlowScenario = {
  name: 'mint quote: change mint during flow',
  steps: [
    // Step 0: Start flow → enterAmount with MINT1
    { type: 'startReceiveLightning' },
    // Step 1: User opens mint selector to switch mints
    { type: 'requestMintSelector' },
    // Step 2: User picks MINT2 instead
    { type: 'changeMint', mintUrl: MINT2 },
    // Step 3: User enters amount with MINT2
    { type: 'enterAmount', amount: 500, mintUrl: MINT2 },
  ],
  waypoints: [
    // After requesting mint selector, we should be in selectMint
    { afterStep: 1, step: 'selectMint' },
  ],
  expect: {
    step: 'mintQuoteCreated',
    // The quote should be created at MINT2, not MINT1
    context: { mintUrl: MINT2 },
  },
};

describe('mint quote — table-driven scenarios', () => {
  it.each([
    MINT_QUOTE_HAPPY,
    MINT_QUOTE_CHANGE_MINT,
  ])('$name', async (scenario) => {
    await runScenario(scenario);
  });
});

// ---------------------------------------------------------------------------
// Mint quote — operations
// ---------------------------------------------------------------------------

/**
 * Verifies that the machine calls the executeMintQuote operation with
 * the correct parameters when the createMintQuote step is reached.
 *
 * The operation creates a Lightning invoice at the specified mint
 * for the specified amount. The operationCalls recording array captures
 * every operation call for assertion.
 */
describe('mint quote — executeMintQuote operation', () => {
  it('calls executeMintQuote when createMintQuote step is reached', async () => {
    const tm = createTestMachine();
    await tm.machine.startReceiveLightning();
    await tm.machine.enterAmount(1000, MINT1);

    // The machine auto-executed the executeMintQuote operation.
    // Find it in the recording array.
    const opCall = tm.operationCalls.find((c) => c.name === 'executeMintQuote');
    expect(opCall).toBeDefined();
    expect(opCall!.args[0]).toBe(MINT1); // mintUrl
    expect(opCall!.args[1]).toBe(1000); // amount
  });
});

// ---------------------------------------------------------------------------
// startReceive — navigateToReceive hub
// ---------------------------------------------------------------------------

/**
 * startReceive() navigates to the receive hub screen where the user can
 * choose between:
 *   - Lightning (mint quote) — creates a Lightning invoice
 *   - Ecash (share token) — generates a receive address or shows QR
 *
 * It's a simple navigation action — no payment logic, just routing.
 */
describe('startReceive', () => {
  it('routes to navigateToReceive', async () => {
    const tm = createTestMachine();
    await tm.machine.startReceive();
    tm.assertStep('navigateToReceive');
  });
});

// ---------------------------------------------------------------------------
// executeMintQuote — error handling
// ---------------------------------------------------------------------------

/**
 * When the executeMintQuote operation fails, the machine must route to
 * the error step with code MINT_QUOTE_FAILED. This ensures the UI can
 * display a meaningful error instead of silently failing.
 */
describe('mint quote — executeMintQuote error handling', () => {
  it('routes to error with MINT_QUOTE_FAILED when operation throws', async () => {
    const tm = createTestMachine({
      operations: {
        executeMintQuote: async () => {
          throw new Error('Mint offline');
        },
      },
    });
    await tm.machine.startReceiveLightning();
    await tm.machine.enterAmount(1000, MINT1);
    tm.assertStep('error');
    tm.assertExecution({ code: 'MINT_QUOTE_FAILED' });
  });

  it('error message contains the operation error text', async () => {
    const tm = createTestMachine({
      operations: {
        executeMintQuote: async () => {
          throw new Error('Connection refused');
        },
      },
    });
    await tm.machine.startReceiveLightning();
    await tm.machine.enterAmount(1000, MINT1);
    tm.assertStep('error');
    const execution = tm.machine.inspect();
    expect(execution.message).toContain('Connection refused');
  });
});

// ---------------------------------------------------------------------------
// executeMintQuote — result data
// ---------------------------------------------------------------------------

/**
 * On success, the auto-executed operation produces a historyEntry that
 * drives the MintQuoteScreen. Verify it's present and parseable.
 */
describe('mint quote — result data', () => {
  it('mintQuoteCreated result contains historyEntry', async () => {
    const tm = createTestMachine();
    await tm.machine.startReceiveLightning();
    await tm.machine.enterAmount(1000, MINT1);
    tm.assertStep('mintQuoteCreated');

    const opCall = tm.operationCalls.find((c) => c.name === 'executeMintQuote');
    expect(opCall).toBeTruthy();
    const historyEntry = (opCall!.result as Record<string, unknown>).historyEntry as string;
    const parsed = JSON.parse(historyEntry);
    expect(parsed.type).toBe('mint');
    expect(typeof parsed.id).toBe('string');
  });
});
