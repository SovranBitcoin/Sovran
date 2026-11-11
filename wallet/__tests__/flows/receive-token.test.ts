/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * receive-token.test.ts — Receive Ecash Token Flow
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests the simplest payment flow: receiving a cashu ecash token. When the
 * user scans or pastes a cashu token, the machine routes directly to
 * receiveToken — no amount entry, no mint selection, no proof picking.
 *
 * Why is it so simple? Because the token IS the payment. It contains:
 *   - The ecash proofs (the actual money)
 *   - The mint URL (where to redeem)
 *   - The amount (sum of proof values)
 *
 * There's nothing for the user to decide — just "accept" or "reject".
 *
 * The one complication is TRUST: if the token came from a mint the user
 * hasn't trusted yet, the app opens the reviewMint step. Trusting happens on
 * the mint page (the `mintInfo.trust` screen action); the token's receive
 * screen underneath redeems it when Redeem is pressed again.
 *
 * This file tests:
 *   - Direct receive: execute(token) → receiveToken
 *   - Prefix variations: cashu:, cashu:// → same result
 *   - Wallet independence: works with any wallet state
 *   - Handler verification: receiveToken handler is called with token data
 *   - Trust review: reviewMint opens the review with the token
 *   - Table-driven scenarios: declarative format for the above flows
 */

import { describe, it, expect } from 'vitest';
import { createTestMachine, runScenario } from '../_harness';
import { WALLETS, INPUTS } from '../_harness/fixtures';
import type { FlowScenario } from '../_harness/types';

// ---------------------------------------------------------------------------
// Receive token — happy path
// ---------------------------------------------------------------------------

describe('receive token — execute cashu token', () => {
  it('routes directly to receiveToken', async () => {
    // The simplest flow in the system: paste a token → receive it.
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.cashuTokenV3, { reset: true });
    tm.assertStep('receiveToken');
  });

  it('calls receiveToken handler with token data', async () => {
    // Verify the machine's handler system works: when the machine reaches
    // receiveToken, it calls the registered handler with the token data
    // so the UI can display amount, mint, etc.
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.cashuTokenV3, { reset: true });
    // Find the handler call for the receiveToken step
    const lastCall = tm.handlerCalls.find((c) => c.step === 'receiveToken');
    expect(lastCall).toBeDefined();
    // The handler receives the token data (for display in the UI)
    expect(lastCall!.data).toHaveProperty('token');
  });

  it('works regardless of wallet state', async () => {
    // Receiving tokens requires NOTHING from the wallet — no balance,
    // no trusted mints, no network. Test across multiple wallet states
    // to prove wallet independence.
    for (const wallet of [WALLETS.default, WALLETS.noBalance, WALLETS.noMints]) {
      const tm = createTestMachine({ wallet });
      await tm.machine.execute(INPUTS.cashuTokenV3, { reset: true });
      tm.assertStep('receiveToken');
    }
  });
});

// ---------------------------------------------------------------------------
// Receive token with prefix variations
// ---------------------------------------------------------------------------

/**
 * Cashu tokens can arrive with different URI scheme prefixes depending on
 * how the sender shared them (deep link, QR code, copy-paste). The
 * normalization layer strips these prefixes, so the parser always sees
 * the raw token string. All variations should produce the same result.
 */
describe('receive token — prefix variations', () => {
  it.each([
    // Bare token — no prefix (e.g. copied from a text message)
    ['bare token', INPUTS.cashuTokenV3],
    // cashu: prefix — standard URI scheme (NUT-XX)
    ['cashu: prefix', `cashu:${INPUTS.cashuTokenV3}`],
    // cashu:// prefix — alternative deep link format (iOS apps)
    ['cashu:// prefix', `cashu://${INPUTS.cashuTokenV3}`],
  ])('%s → receiveToken', async (_name, input) => {
    const tm = createTestMachine();
    await tm.machine.execute(input, { reset: true });
    tm.assertStep('receiveToken');
  });
});

// ---------------------------------------------------------------------------
// Receive token via mint trust review flow
// ---------------------------------------------------------------------------

/**
 * When the token's mint isn't trusted by the user, the app shows a
 * review screen before accepting the token:
 *   reviewMint(untrustedMint, token) → reviewMint step
 *
 * Note: the trust check itself happens in the app layer (not in the
 * machine) — the app calls reviewMint() when it detects an untrusted mint,
 * and trusting is the mint page's `trust` screen action.
 */
describe('receive token — trust review flow', () => {
  it('reviewMint opens the review with the mint and the token', async () => {
    const tm = createTestMachine();
    // App detects untrusted mint and initiates review
    await tm.machine.reviewMint('https://new.mint.example.com', INPUTS.cashuTokenV3);
    tm.assertStep('reviewMint');
    expect(tm.handlerCalls.at(-1)).toMatchObject({
      step: 'reviewMint',
      data: { mintUrl: 'https://new.mint.example.com', token: INPUTS.cashuTokenV3 },
    });
  });

  it('keeps the scanned input of the token receive it interrupts', async () => {
    // The redeem after trusting matches the scan history by this input.
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.cashuTokenV3);
    tm.assertStep('receiveToken');
    await tm.machine.reviewMint('https://new.mint.example.com', INPUTS.cashuTokenV3);
    tm.assertStep('reviewMint');
    tm.assertContext({ rawInput: INPUTS.cashuTokenV3 });
  });
});

// ---------------------------------------------------------------------------
// Receive token — scenario format
// ---------------------------------------------------------------------------

/**
 * The same flows expressed as declarative FlowScenarios. This format
 * is useful for documenting expected behavior and for data-driven testing.
 */
const RECEIVE_SCENARIOS: FlowScenario[] = [
  {
    name: 'receive cashu token: execute → receiveToken',
    steps: [{ type: 'execute', input: INPUTS.cashuTokenV3 }],
    expect: { step: 'receiveToken' },
  },
  {
    name: 'review an untrusted mint: reviewMint → reviewMint',
    steps: [
      // App initiates review for untrusted mint
      { type: 'reviewMint', mintUrl: 'https://new.example.com', token: INPUTS.cashuTokenV3 },
    ],
    expect: { step: 'reviewMint' },
  },
];

describe('receive token — table-driven scenarios', () => {
  it.each(RECEIVE_SCENARIOS)('$name', async (scenario) => {
    await runScenario(scenario);
  });
});

// ---------------------------------------------------------------------------
// Notification timeline — machine level
// ---------------------------------------------------------------------------

/**
 * Unlike send, melt, and mint quote, the receive token flow fires NO machine
 * notifications. The machine only routes to the receiveToken step — the actual
 * receive operation (and its notifications: onReceiveProcessing, onReceiveConfirmed,
 * onTransactionCreated) fires from the screen action handler (receiveToken.redeem).
 *
 * These tests document that the machine layer is intentionally silent during
 * receive routing. Screen-action notification coverage lives in
 * __tests__/screen-actions/defaultHandlers.test.ts.
 */
describe('receive token — no machine notifications during routing', () => {
  it('fires no payment notifications when routing to receiveToken', async () => {
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.cashuTokenV3, { reset: true });
    tm.assertStep('receiveToken');

    // onScanResolved fires for any execute() call — that's expected.
    // But no payment notifications (processing, confirmed, txCreated) should fire.
    const paymentKeys = tm.notificationCalls
      .map((c) => c.key)
      .filter((k) => k !== 'onScanResolved');
    expect(paymentKeys).toHaveLength(0);
  });

  it('fires no notifications during trust review flow', async () => {
    const tm = createTestMachine();
    await tm.machine.reviewMint('https://new.mint.example.com', INPUTS.cashuTokenV3);
    tm.assertStep('reviewMint');

    expect(tm.notificationCalls).toHaveLength(0);
  });
});
