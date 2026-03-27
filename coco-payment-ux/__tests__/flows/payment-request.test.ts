/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * payment-request.test.ts — Payment Request Flow
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Payment requests (creq-prefixed CBOR) are the most information-rich
 * payment format. They specify: target mints, amount, unit, and transport
 * method (HTTP POST or Nostr). When a valid PR is scanned:
 *
 *   1. Parser decodes the CBOR and extracts mint URLs, amount, unit
 *   2. Guards check: trusted mint? sufficient balance?
 *   3. If all clear → auto-route to navigateToPaymentRequest
 *   4. If not → error (with specific reason: MINT_NOT_TRUSTED, etc.)
 *
 * INPUTS.paymentRequestBasic targets MINT1 with amount=100, unit=sat,
 * transport=POST. The machine verifies MINT1 is trusted and has balance.
 *
 * Payment requests skip the proof picker because the amount is fixed
 * (specified in the PR) — the user can't choose to send a different amount.
 * The mint handles proof composition during the send operation.
 *
 * The confirmPaymentRequest step is handled by the machine wrapper:
 * when the UI confirms, it calls executePaymentRequest() which sends
 * ecash to the PR's transport endpoint.
 */

import { describe, it, expect } from 'vitest';
import { createTestMachine, runScenario } from '../_harness';
import { WALLETS, MINT1, INPUTS, UNTRUSTED_MINT } from '../_harness/fixtures';
import type { FlowScenario } from '../_harness/types';

// ---------------------------------------------------------------------------
// Payment request — happy path (matching mint + sufficient balance)
// ---------------------------------------------------------------------------

const PR_HAPPY: FlowScenario = {
  name: 'payment request: matching mint with balance → navigateToPaymentRequest',
  steps: [
    // Execute the payment request string. The machine:
    //   1. Parses CBOR → extracts MINT1, amount=100, unit=sat
    //   2. Checks guards: MINT1 trusted ✓, balance 1000 >= 100 ✓
    //   3. Auto-routes to navigateToPaymentRequest
    { type: 'execute', input: INPUTS.paymentRequestBasic },
  ],
  expect: {
    step: 'navigateToPaymentRequest',
    context: {
      // The decoded payment request string is in context
      paymentRequest: expect.any(String),
      // MINT1 was auto-selected (it's in the PR's mint list and trusted)
      mintUrl: MINT1,
    },
  },
};

describe('payment request — table-driven', () => {
  it.each([PR_HAPPY])('$name', async (scenario) => {
    await runScenario(scenario);
  });
});

// ---------------------------------------------------------------------------
// Payment request — no matching trusted mint
// ---------------------------------------------------------------------------

/**
 * If the payment request specifies mints that the user hasn't trusted,
 * the machine can't fulfill it → routes to error. The user would need
 * to add the mint first, then re-scan.
 */
describe('payment request — no matching mint', () => {
  it('routes to error when no trusted mint matches', async () => {
    // WALLETS.noMints has trustedMintUrls=[] → no intersection with PR's mints
    const tm = createTestMachine({ wallet: WALLETS.noMints });
    await tm.machine.execute(INPUTS.paymentRequestBasic, { reset: true });
    tm.assertStep('error');
  });
});

// ---------------------------------------------------------------------------
// Payment request — insufficient balance
// ---------------------------------------------------------------------------

/**
 * The PR requires 100 sats, but WALLETS.insufficientBalance only has 50.
 * Even though the mint is trusted, there's not enough ecash to send.
 */
describe('payment request — insufficient balance', () => {
  it('routes to error when balance below PR amount', async () => {
    const tm = createTestMachine({ wallet: WALLETS.insufficientBalance });
    await tm.machine.execute(INPUTS.paymentRequestBasic, { reset: true });
    tm.assertStep('error');
  });
});

// ---------------------------------------------------------------------------
// Payment request never shows proof selector
// ---------------------------------------------------------------------------

/**
 * Payment requests have a fixed amount — the user can't round down or up.
 * The mint handles proof composition during the send operation, so the
 * proof picker is never shown, even with non-exact proof denominations.
 */
describe('payment request — no proof selector', () => {
  it('skips chooseProofs even with non-exact proof amounts', async () => {
    const tm = createTestMachine({ wallet: WALLETS.noExactProofs });
    await tm.machine.execute(INPUTS.paymentRequestBasic, { reset: true });
    expect(tm.machine.getStep()).not.toBe('chooseProofs');
  });
});

// ---------------------------------------------------------------------------
// Payment request — confirmPaymentRequest operation
// ---------------------------------------------------------------------------

/**
 * After the machine reaches navigateToPaymentRequest, the UI shows a
 * confirmation screen. When the user taps "Confirm", the machine calls
 * confirmPaymentRequest() which triggers the executePaymentRequest
 * operation.
 *
 * This test uses a custom operation override to verify the operation
 * is actually called with the right parameters.
 */
describe('payment request — confirmPaymentRequest', () => {
  it('calls executePaymentRequest operation', async () => {
    const tm = createTestMachine({
      operations: {
        // Custom operation that returns a mock history entry
        executePaymentRequest: async () => ({
          historyEntry: JSON.stringify({ id: 'pr-1', type: 'send', state: 'pending' }),
        }),
      },
    });
    await tm.machine.execute(INPUTS.paymentRequestBasic, { reset: true });

    tm.assertStep('navigateToPaymentRequest');
    await tm.machine.confirmPaymentRequest();
    // Verify the operation was called (recorded by the harness)
    const opCall = tm.operationCalls.find((c) => c.name === 'executePaymentRequest');
    expect(opCall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// confirmPaymentRequest — notification sequence
// ---------------------------------------------------------------------------

/**
 * After the user confirms a payment request, the machine must fire
 * notifications in the same multi-stage sequence as melt:
 *   1. onPaymentProcessing — shows "Payment request sent / Waiting..."
 *   2. onPaymentConfirmed (success) or onPaymentFailed (error)
 *
 * This sequence drives the multi-stage toast: the same toast transitions
 * from "Processing..." to "Claimed by recipient" without creating a
 * second notification.
 */
describe('payment request — confirmPaymentRequest notification sequence', () => {
  it('fires onPaymentProcessing then onPaymentConfirmed on success', async () => {
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.paymentRequestBasic, { reset: true });
    tm.assertStep('navigateToPaymentRequest');

    await tm.machine.confirmPaymentRequest();

    const processing = tm.notificationCalls.find((c) => c.key === 'onPaymentProcessing');
    expect(processing).toBeTruthy();
    expect(processing!.data).toMatchObject({
      variant: 'paymentRequest',
      mintUrl: MINT1,
      unit: 'sat',
    });

    const confirmed = tm.notificationCalls.find((c) => c.key === 'onPaymentConfirmed');
    expect(confirmed).toBeTruthy();
    expect(confirmed!.data).toMatchObject({
      variant: 'paymentRequest',
      mintUrl: MINT1,
      unit: 'sat',
    });

    // historyEntry must be parseable JSON with an id for store correlation
    const historyEntry = (confirmed!.data as Record<string, unknown>).historyEntry;
    expect(typeof historyEntry).toBe('string');
    const parsed = JSON.parse(historyEntry as string);
    expect(typeof parsed.id).toBe('string');

    // Processing must come before confirmed
    const processingIdx = tm.notificationCalls.findIndex((c) => c.key === 'onPaymentProcessing');
    const confirmedIdx = tm.notificationCalls.findIndex((c) => c.key === 'onPaymentConfirmed');
    expect(processingIdx).toBeLessThan(confirmedIdx);
  });

  it('fires onPaymentProcessing then onPaymentFailed on error', async () => {
    const tm = createTestMachine({
      operations: {
        executePaymentRequest: async () => {
          throw new Error('Transport unreachable');
        },
      },
    });
    await tm.machine.execute(INPUTS.paymentRequestBasic, { reset: true });
    tm.assertStep('navigateToPaymentRequest');

    await tm.machine.confirmPaymentRequest();

    const processing = tm.notificationCalls.find((c) => c.key === 'onPaymentProcessing');
    expect(processing).toBeTruthy();

    const failed = tm.notificationCalls.find((c) => c.key === 'onPaymentFailed');
    expect(failed).toBeTruthy();
    expect(failed!.data).toMatchObject({
      variant: 'paymentRequest',
      message: expect.any(String),
    });

    // No confirmed notification should exist
    const confirmed = tm.notificationCalls.find((c) => c.key === 'onPaymentConfirmed');
    expect(confirmed).toBeUndefined();
  });

  it('calls executePaymentRequest with correct arguments', async () => {
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.paymentRequestBasic, { reset: true });

    await tm.machine.confirmPaymentRequest();

    const opCall = tm.operationCalls.find((c) => c.name === 'executePaymentRequest');
    expect(opCall).toBeTruthy();
    // Args: (mintUrl, paymentRequest, amount, unit)
    expect(opCall!.args[0]).toBe(MINT1);
    expect(typeof opCall!.args[1]).toBe('string'); // paymentRequest string
    expect(opCall!.args[3]).toBe('sat');
  });
});
