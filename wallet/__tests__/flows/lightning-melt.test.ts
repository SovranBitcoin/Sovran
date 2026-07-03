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
 *   - No proof-composition selector: melts skip offline proof alternatives
 *   - Insufficient online amount can offer a balance-based round-down
 *
 * That distinction is critical: non-exact proof denominations alone should
 * not open chooseProofs for melts, but an online insufficient-balance amount
 * can offer a lower amount before melt quote creation.
 */

import { describe, it, expect } from 'vitest';
import { createTestMachine, runScenario } from '../_harness';
import { WALLETS, MINT1, MINT2, MINT3, INPUTS } from '../_harness/fixtures';
import type { FlowScenario } from '../_harness/types';

const USER_LIGHTNING_INVOICE =
  'lnbc10u1p4pcn75pp5nx5zweympssrmvmecek6n3ynhj7emfe3dynls8q3yu62uhje9rksdqqcqzzsxqyz5vqsp5lersjjw2atsnqhzhqac00xvvcelcw6gqfy7u2jka25q9y2dhczns9qxpqysgqckuv826yw544mrwgnt6k0r529wrczsj03hwrtgg0ch4gewreqt75gg838wrd6twg5dp7n9m9eze6km22svvx8jq5jmrv4pvr0q4dffqpp0ftc3';

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
  steps: [{ type: 'execute', input: INPUTS.lightningAddress }],
  expect: {
    step: 'enterAmount',
  },
};

describe('lightning melt — lightning address scenarios', () => {
  it.each([LIGHTNING_ADDRESS_HAPPY, LIGHTNING_ADDRESS_NO_BALANCE])('$name', async (scenario) => {
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
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);
    // Context should show MINT1 was selected
    tm.assertContext({ mintUrl: MINT1 });
  });

  it('allows mint change during flow', async () => {
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);
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
// Melt never shows proof-composition selector (mint handles swap server-side)
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
 * Therefore, proof denomination mismatch alone must not route melts to
 * chooseProofs. Only an online insufficient-balance fallback can use the
 * same choose amount surface.
 */
describe('lightning melt — no proof selector', () => {
  it('skips chooseProofs even with non-exact proof amounts', async () => {
    // WALLETS.noExactProofs has proofs that can't compose exactly 100 sats.
    // For an ecash send, this would route to chooseProofs.
    // For a melt, it should skip straight to navigateToMeltPreview.
    const tm = createTestMachine({ wallet: WALLETS.noExactProofs });
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1);
    tm.assertStep('navigateToMeltPreview');
  });

  it('shows chooseProofs with balance round-down when no mint covers the full online amount', async () => {
    const tm = createTestMachine({ wallet: WALLETS.insufficientBalance });
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1);

    tm.assertStep('chooseProofs');
    const lastHandler = tm.handlerCalls[tm.handlerCalls.length - 1];
    expect(lastHandler).toMatchObject({
      step: 'chooseProofs',
      data: {
        meltTarget: INPUTS.lightningAddress,
        suggestions: {
          roundDown: { amount: 50 },
          roundUp: null,
        },
      },
    });

    await tm.machine.chooseProofs(50);
    tm.assertStep('navigateToMeltPreview');
    tm.assertContext({ amount: 50, mintUrl: MINT1, destination: 'meltQuote' });
  });

  it('does not show chooseProofs for lightning while offline', async () => {
    const tm = createTestMachine({ wallet: WALLETS.insufficientBalance, offline: true });
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1);

    tm.assertStep('error');
  });
});

describe('lightning melt — pasted invoice mint selection', () => {
  it('selects a full-balance alternate mint instead of offering a round-down', async () => {
    const tm = createTestMachine({ wallet: WALLETS.multiMintUnbalanced });

    await tm.machine.execute(USER_LIGHTNING_INVOICE, { reset: true });

    tm.assertStep('navigateToMeltPreview');
    tm.assertContext({
      amount: 1000,
      mintUrl: MINT1,
      destination: 'meltQuote',
      meltTarget: USER_LIGHTNING_INVOICE,
    });
    const lastHandler = tm.handlerCalls[tm.handlerCalls.length - 1];
    expect(lastHandler).toMatchObject({
      step: 'navigateToMeltPreview',
      data: {
        mintUrl: MINT1,
        amount: 1000,
        meltTarget: USER_LIGHTNING_INVOICE,
      },
    });
  });

  it('auto-picks the preferred mint when several mints can each cover the invoice', async () => {
    // Regression: with 2+ funded mints the machine used to force the mint
    // selector. It should now auto-pick the preferred mint and land on the
    // confirm screen (the user can still change via the mint pill).
    const tm = createTestMachine({
      wallet: {
        trustedMintUrls: [MINT1, MINT2],
        mintBalances: { [MINT1]: 1500, [MINT2]: 2000 },
        mintMethodCapabilities: WALLETS.default.mintMethodCapabilities,
        preferredMintUrl: MINT1,
        proofAmounts: {
          [MINT1]: [1024, 256, 128, 64, 16, 8, 4],
          [MINT2]: [1024, 512, 256, 128, 64, 16],
        },
      },
    });

    await tm.machine.execute(USER_LIGHTNING_INVOICE, { reset: true });

    tm.assertStep('navigateToMeltPreview');
    tm.assertContext({
      amount: 1000,
      mintUrl: MINT1,
      destination: 'meltQuote',
      meltTarget: USER_LIGHTNING_INVOICE,
    });
  });

  it('falls back to the highest-balance mint when the preferred mint cannot cover the invoice', async () => {
    const tm = createTestMachine({
      wallet: {
        trustedMintUrls: [MINT1, MINT2, MINT3],
        // Preferred MINT3 is funded but below the 1000-sat invoice amount, so
        // it is not an eligible candidate; pick the richest eligible mint.
        mintBalances: { [MINT1]: 1500, [MINT2]: 3000, [MINT3]: 200 },
        mintMethodCapabilities: WALLETS.default.mintMethodCapabilities,
        preferredMintUrl: MINT3,
        proofAmounts: {
          [MINT1]: [1024, 256, 128, 64, 16, 8, 4],
          [MINT2]: [2048, 512, 256, 128, 32, 16, 8],
          [MINT3]: [128, 64, 8],
        },
      },
    });

    await tm.machine.execute(USER_LIGHTNING_INVOICE, { reset: true });

    tm.assertStep('navigateToMeltPreview');
    tm.assertContext({
      amount: 1000,
      mintUrl: MINT2,
      destination: 'meltQuote',
      meltTarget: USER_LIGHTNING_INVOICE,
    });
  });

  it('uses the highest partial mint for the Lightning round-down fallback', async () => {
    const tm = createTestMachine({
      wallet: {
        trustedMintUrls: [MINT1, MINT2],
        mintBalances: { [MINT1]: 980, [MINT2]: 990 },
        mintMethodCapabilities: WALLETS.default.mintMethodCapabilities,
        preferredMintUrl: MINT1,
        proofAmounts: {
          [MINT1]: [512, 256, 128, 64, 16, 4],
          [MINT2]: [512, 256, 128, 64, 16, 8, 4, 2],
        },
      },
    });

    await tm.machine.execute(USER_LIGHTNING_INVOICE, { reset: true });

    tm.assertStep('chooseProofs');
    tm.assertContext({
      amount: 1000,
      mintUrl: MINT2,
      destination: 'meltQuote',
      meltTarget: USER_LIGHTNING_INVOICE,
    });
    const lastHandler = tm.handlerCalls[tm.handlerCalls.length - 1];
    expect(lastHandler).toMatchObject({
      step: 'chooseProofs',
      data: {
        mintUrl: MINT2,
        meltTarget: USER_LIGHTNING_INVOICE,
        suggestions: {
          roundDown: { amount: 990 },
          roundUp: null,
        },
      },
    });
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
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);
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
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);
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
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);

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
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);

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

  it('full success sequence: onPaymentProcessing → onPaymentConfirmed → onTransactionCreated → onMeltQuoteCreated', async () => {
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);

    // Clear notifications from the routing phase (onScanResolved fires during execute)
    tm.notificationCalls.length = 0;

    await tm.machine.confirmMelt();

    const keys = tm.notificationCalls.map((c) => c.key);
    expect(keys).toEqual([
      'onPaymentProcessing',
      'onPaymentConfirmed',
      'onTransactionCreated',
      'onMeltQuoteCreated',
    ]);
  });

  it('onTransactionCreated carries type=melt with transactionId, mintUrl, amount, unit', async () => {
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);
    await tm.machine.confirmMelt();

    const txCreated = tm.notificationCalls.find((c) => c.key === 'onTransactionCreated');
    expect(txCreated!.data).toMatchObject({
      type: 'melt',
      mintUrl: MINT1,
      amount: 200,
      unit: 'sat',
      transactionId: expect.any(String),
    });
  });

  it('onMeltQuoteCreated carries mintUrl, operationId, amount, unit, meltTarget', async () => {
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);
    await tm.machine.confirmMelt();

    const meltQuote = tm.notificationCalls.find((c) => c.key === 'onMeltQuoteCreated');
    expect(meltQuote!.data).toMatchObject({
      mintUrl: MINT1,
      operationId: expect.any(String),
      amount: 200,
      unit: 'sat',
      meltTarget: INPUTS.lightningAddress,
    });
  });

  it('full failure sequence: only onPaymentProcessing → onPaymentFailed (no txCreated, no meltQuoteCreated)', async () => {
    const tm = createTestMachine({
      operations: {
        executeMelt: async () => {
          throw new Error('Route not found');
        },
      },
    });
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);

    tm.notificationCalls.length = 0;

    await tm.machine.confirmMelt();

    const keys = tm.notificationCalls.map((c) => c.key);
    expect(keys).toEqual(['onPaymentProcessing', 'onPaymentFailed']);
  });
});
