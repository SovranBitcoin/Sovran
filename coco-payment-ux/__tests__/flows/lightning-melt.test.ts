/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * lightning-melt.test.ts — Lightning Melt Flow
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Melting" is the process of converting ecash back to Lightning. The user
 * provides a Lightning address (user@example.com) or LNURL-pay endpoint,
 * enters an amount, and the wallet sends ecash to the mint in exchange for
 * a Lightning payment to the target.
 *
 * Flow: execute(address) → enterAmount → navigateToMeltPreview
 *
 * Lightning addresses and LNURL-pay are "amountless" — unlike bolt11
 * invoices that encode a specific amount, the user must enter how much
 * they want to send. This is why the machine always routes to enterAmount
 * first.
 *
 * Key behaviors tested:
 *   - Happy path: address → enterAmount → navigateToMeltPreview
 *   - No balance: still routes to enterAmount (error surfaces later)
 *   - Mint selection: preferred mint is auto-selected, user can change
 *   - LNURL-pay: same flow as lightning address
 *   - NO proof selector: melts NEVER show chooseProofs — the mint handles
 *     proof swapping server-side during the melt operation
 *
 * That last point is critical: unlike ecash sends where the user must
 * compose exact proofs offline, melts always go through the mint which
 * can swap proofs to the exact amount. So even with "non-exact" proof
 * sets, melts skip the proof picker entirely.
 */

import { describe, it, expect } from 'vitest';
import { createTestMachine, runScenario } from '../_harness';
import { WALLETS, MINT1, MINT2, INPUTS } from '../_harness/fixtures';
import type { FlowScenario } from '../_harness/types';

// ---------------------------------------------------------------------------
// Lightning address — needs amount first
// ---------------------------------------------------------------------------

/**
 * Table-driven scenarios for lightning address flow variations.
 */

const LIGHTNING_ADDRESS_HAPPY: FlowScenario = {
  name: 'lightning address: execute → enterAmount → navigateToMeltPreview',
  steps: [
    // Step 0: Parse the lightning address, resolve intent, route to enterAmount
    { type: 'execute', input: INPUTS.lightningAddress },
    // Step 1: User enters 200 sats at MINT1 → machine routes to melt preview
    { type: 'enterAmount', amount: 200, mintUrl: MINT1 },
  ],
  waypoints: [
    // After parsing, we should be waiting for amount input
    { afterStep: 0, step: 'enterAmount' },
  ],
  expect: {
    step: 'navigateToMeltPreview',
    context: {
      // The lightning address is preserved in context for the melt operation
      meltTarget: INPUTS.lightningAddress,
      amount: 200,
      mintUrl: MINT1,
    },
  },
};

const LIGHTNING_ADDRESS_NO_BALANCE: FlowScenario = {
  name: 'lightning address: no balance → enterAmount (error surfaces at mint selection)',
  // With no balance, the machine still routes to enterAmount because
  // lightning addresses always need an amount first. The balance error
  // only surfaces when the user tries to select a mint or confirm.
  wallet: WALLETS.noBalance,
  steps: [
    { type: 'execute', input: INPUTS.lightningAddress },
  ],
  expect: {
    step: 'enterAmount',
  },
};

describe('lightning melt — lightning address scenarios', () => {
  it.each([
    LIGHTNING_ADDRESS_HAPPY,
    LIGHTNING_ADDRESS_NO_BALANCE,
  ])('$name', async (scenario) => {
    await runScenario(scenario);
  });
});

// ---------------------------------------------------------------------------
// Lightning address — mint selection
// ---------------------------------------------------------------------------

/**
 * Tests mint selection behavior during the melt flow:
 *   - Preferred mint is auto-selected when entering amount
 *   - User can request the mint selector to change mints mid-flow
 */
describe('lightning melt — mint selection', () => {
  it('uses preferred mint when valid', async () => {
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    // Enter amount with MINT1 (the preferred mint)
    await tm.machine.enterAmount(200, MINT1);
    // Context should show MINT1 was selected
    tm.assertContext({ mintUrl: MINT1 });
  });

  it('allows mint change during flow', async () => {
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount(200, MINT1);
    tm.assertStep('navigateToMeltPreview');

    // User decides to use MINT2 instead — request the mint selector
    await tm.machine.requestMintSelector();
    tm.assertStep('selectMint');

    // Select MINT2 and continue the flow
    await tm.machine.changeMint(MINT2);
    // Should advance past selectMint (exact step depends on flow state)
    expect(tm.machine.getStep()).not.toBe('selectMint');
  });
});

// ---------------------------------------------------------------------------
// LNURL-pay
// ---------------------------------------------------------------------------

/**
 * LNURL-pay endpoints (lnurlp://) follow the same flow as lightning
 * addresses — they're amountless and need user input. The only difference
 * is how the resolver fetches the final Lightning invoice (address uses
 * LNURL-pay protocol, lnurlp uses the URL directly).
 */
describe('lightning melt — lnurlp', () => {
  it('routes lnurlp to enterAmount (needs amount)', async () => {
    const tm = createTestMachine();
    // Note: must use lnurlp:// prefix for the parser to detect it as lnurlp
    // (raw HTTPS URLs are classified as mint URLs)
    await tm.machine.execute('lnurlp://pay.example.com/lnurlp/xyz', { reset: true });
    tm.assertStep('enterAmount');
  });
});

// ---------------------------------------------------------------------------
// Melt never shows proof selector (mint handles swap server-side)
// ---------------------------------------------------------------------------

/**
 * This is a critical behavioral distinction between ecash sends and melts:
 *
 * ECASH SEND (offline-capable):
 *   User must compose exact proofs → may need chooseProofs step
 *
 * LIGHTNING MELT (always online):
 *   The mint handles proof swapping during the melt operation. The user
 *   sends whatever proofs they have, and the mint swaps them to the exact
 *   amount before making the Lightning payment.
 *
 * Therefore, melts should NEVER route to chooseProofs, even when the
 * wallet's proof denominations don't exactly match the entered amount.
 */
describe('lightning melt — no proof selector', () => {
  it('skips chooseProofs even with non-exact proof amounts', async () => {
    // WALLETS.noExactProofs has proofs that can't compose exactly 100 sats.
    // For an ecash send, this would route to chooseProofs.
    // For a melt, it should skip straight to navigateToMeltPreview.
    const tm = createTestMachine({ wallet: WALLETS.noExactProofs });
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount(100, MINT1);
    tm.assertStep('navigateToMeltPreview');
  });
});

// ---------------------------------------------------------------------------
// confirmMelt — notification sequence
// ---------------------------------------------------------------------------

/**
 * After the user confirms a melt, the machine must fire notifications in a
 * strict sequence so the toast transitions correctly:
 *   1. onPaymentProcessing — shows "Payment sent / Processing..."
 *   2. onPaymentConfirmed (success) or onPaymentFailed (error)
 *
 * Both notifications must carry the correct variant, mintUrl, amount, and
 * unit so the toast and store stay in sync. These tests verify the machine
 * fires them in the right order with the right data.
 */
describe('lightning melt — confirmMelt notification sequence', () => {
  it('fires onPaymentProcessing then onPaymentConfirmed on success', async () => {
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount(200, MINT1);
    tm.assertStep('navigateToMeltPreview');

    await tm.machine.confirmMelt();

    // onPaymentProcessing should fire with variant 'melt'
    const processing = tm.notificationCalls.find((c) => c.key === 'onPaymentProcessing');
    expect(processing).toBeTruthy();
    expect(processing!.data).toMatchObject({
      variant: 'melt',
      mintUrl: MINT1,
      amount: 200,
      unit: 'sat',
    });

    // onPaymentConfirmed should fire after executeMelt succeeds
    const confirmed = tm.notificationCalls.find((c) => c.key === 'onPaymentConfirmed');
    expect(confirmed).toBeTruthy();
    expect(confirmed!.data).toMatchObject({
      variant: 'melt',
      mintUrl: MINT1,
      amount: 200,
      unit: 'sat',
    });
    // historyEntry should be a JSON string with the melt result
    expect((confirmed!.data as Record<string, unknown>).historyEntry).toEqual(expect.any(String));

    // Processing must come before confirmed (multi-stage toast relies on this order)
    const processingIdx = tm.notificationCalls.findIndex((c) => c.key === 'onPaymentProcessing');
    const confirmedIdx = tm.notificationCalls.findIndex((c) => c.key === 'onPaymentConfirmed');
    expect(processingIdx).toBeLessThan(confirmedIdx);
  });

  it('fires onPaymentProcessing then onPaymentFailed on error', async () => {
    const tm = createTestMachine({
      operations: {
        executeMelt: async () => {
          throw new Error('Lightning route failed');
        },
      },
    });
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount(200, MINT1);
    tm.assertStep('navigateToMeltPreview');

    await tm.machine.confirmMelt();

    const processing = tm.notificationCalls.find((c) => c.key === 'onPaymentProcessing');
    expect(processing).toBeTruthy();

    const failed = tm.notificationCalls.find((c) => c.key === 'onPaymentFailed');
    expect(failed).toBeTruthy();
    expect(failed!.data).toMatchObject({
      variant: 'melt',
      message: expect.any(String),
    });

    // No confirmed notification should exist
    const confirmed = tm.notificationCalls.find((c) => c.key === 'onPaymentConfirmed');
    expect(confirmed).toBeUndefined();
  });

  it('calls executeMelt with correct arguments', async () => {
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount(200, MINT1);

    await tm.machine.confirmMelt();

    const meltCall = tm.operationCalls.find((c) => c.name === 'executeMelt');
    expect(meltCall).toBeTruthy();
    expect(meltCall!.args).toEqual([MINT1, INPUTS.lightningAddress, 200, 'sat']);
  });

  it('onPaymentConfirmed historyEntry contains quoteId for store correlation', async () => {
    // Consumers like usePaymentStatusListener match the confirmed notification
    // against the active store entry. The historyEntry must contain a parseable
    // JSON with a quoteId so listeners can correlate melt-op events.
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount(200, MINT1);

    await tm.machine.confirmMelt();

    const confirmed = tm.notificationCalls.find((c) => c.key === 'onPaymentConfirmed');
    expect(confirmed).toBeTruthy();

    const historyEntry = (confirmed!.data as Record<string, unknown>).historyEntry;
    expect(typeof historyEntry).toBe('string');

    const parsed = JSON.parse(historyEntry as string);
    expect(parsed.type).toBe('melt');
    expect(parsed.state).toBe('PAID');
    expect(typeof parsed.id).toBe('string');
  });
});
