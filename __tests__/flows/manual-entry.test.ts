/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * manual-entry.test.ts — Manual Entry Flows (Send/Receive Buttons)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These tests cover flows initiated by UI buttons (not QR/paste):
 *   - "Send" button → startSendEcash()
 *   - "Receive" → "Lightning" → startReceiveLightning()
 *   - "Receive" button → startReceive()
 *
 * Unlike execute() flows (which parse user input), manual entry flows
 * have a known destination from the start:
 *   - startSendEcash: destination='sendEcash'
 *   - startReceiveLightning: destination='mintQuote'
 *   - startReceive: destination=navigateToReceive (hub screen)
 *
 * The main routing question for manual entry is: "which mint should we use?"
 *   - Single mint → auto-select it
 *   - Multiple mints + preferred → auto-select preferred
 *   - Multiple mints + no preferred → selectMint (user chooses)
 *   - No balance (for sends) → error
 *
 * This file also tests enterAmount() with explicit destination parameter,
 * which is used for direct navigation (bypassing the normal flow start).
 */

import { describe, it, expect } from 'vitest';
import { createTestMachine, runScenario } from '../_harness';
import { WALLETS, MINT1, MINT2, MINT3 } from '../_harness/fixtures';
import type { FlowScenario } from '../_harness/types';

// ---------------------------------------------------------------------------
// Manual send flows (no EXECUTE — user taps Send/Receive buttons)
// ---------------------------------------------------------------------------

/**
 * startSendEcash() routing depends on the wallet's mint configuration:
 *   - singleMint: only one choice → auto-select → enterAmount
 *   - default (2 mints, has preferred): auto-select preferred → enterAmount
 *   - default (2 mints, no preferred): must ask user → selectMint
 *   - noBalance: can't send → error
 */
describe('manual entry — startSendEcash', () => {
  it('single mint: auto-selects mint → enterAmount', async () => {
    // WALLETS.singleMint has only MINT1 — no ambiguity about which mint
    const tm = createTestMachine({ wallet: WALLETS.singleMint });
    await tm.machine.startSendEcash();
    tm.assertStep('enterAmount');
    // MINT1 auto-selected as the only option
    tm.assertContext({ mintUrl: MINT1 });
  });

  it('multi mint with preferred: auto-selects preferred → enterAmount', async () => {
    // WALLETS.default has MINT1 (preferred) and MINT2
    const tm = createTestMachine();
    await tm.machine.startSendEcash();
    tm.assertStep('enterAmount');
    // Preferred mint (MINT1) auto-selected
    tm.assertContext({ mintUrl: MINT1 });
  });

  it('multi mint no preferred: selectMint', async () => {
    // Remove preference → machine doesn't know which mint to use → ask user
    const tm = createTestMachine({
      wallet: { ...WALLETS.default, preferredMintUrl: undefined },
    });
    await tm.machine.startSendEcash();
    tm.assertStep('selectMint');
  });

  it('no balance: error', async () => {
    // Can't send with zero balance → immediate error
    const tm = createTestMachine({ wallet: WALLETS.noBalance });
    await tm.machine.startSendEcash();
    tm.assertStep('error');
  });

  it('chat send-money: reuses send guard while seeding lightning target', async () => {
    const recipientPubkey = 'a'.repeat(64);
    const tm = createTestMachine();

    await tm.machine.startSendEcash({
      meltTarget: 'alice@example.com',
      recipientPubkey,
    });

    tm.assertStep('enterAmount');
    tm.assertContext({
      destination: 'sendEcash',
      mintUrl: MINT1,
      meltTarget: 'alice@example.com',
      recipientPubkey,
    });
    const lastHandler = tm.handlerCalls[tm.handlerCalls.length - 1];
    expect(lastHandler).toMatchObject({
      step: 'enterAmount',
      data: {
        preselectedMintUrl: MINT1,
        constraints: {
          destination: 'sendEcash',
          meltTarget: 'alice@example.com',
          recipientPubkey,
        },
      },
    });
  });

  it('chat send-money: keeps lightning target when mint selection is required', async () => {
    const recipientPubkey = 'b'.repeat(64);
    const tm = createTestMachine({
      wallet: { ...WALLETS.default, preferredMintUrl: undefined },
    });

    await tm.machine.startSendEcash({
      meltTarget: 'bob@example.com',
      recipientPubkey,
    });

    tm.assertStep('selectMint');
    tm.assertContext({
      destination: 'sendEcash',
      meltTarget: 'bob@example.com',
      recipientPubkey,
    });
    const lastHandler = tm.handlerCalls[tm.handlerCalls.length - 1];
    expect(lastHandler).toMatchObject({
      step: 'selectMint',
      data: {
        destination: 'sendEcash',
        meltTarget: 'bob@example.com',
        recipientPubkey,
      },
    });
  });

  it('chat send-money lightning: opens mint selector when another mint can cover the entered amount', async () => {
    const recipientPubkey = 'c'.repeat(64);
    const tm = createTestMachine({ wallet: WALLETS.multiMintUnbalanced });

    await tm.machine.startSendEcash({
      meltTarget: 'alice@example.com',
      recipientPubkey,
    });
    tm.assertStep('enterAmount');
    tm.assertContext({ mintUrl: MINT2 });

    await tm.machine.enterAmount(200, MINT2, {
      destination: 'meltQuote',
      meltTarget: 'alice@example.com',
      recipientPubkey,
    });

    tm.assertStep('selectMint');
    tm.assertContext({
      amount: 200,
      destination: 'meltQuote',
      mintUrl: MINT2,
      meltTarget: 'alice@example.com',
      recipientPubkey,
    });
    let lastHandler = tm.handlerCalls[tm.handlerCalls.length - 1];
    expect(lastHandler).toMatchObject({
      step: 'selectMint',
      data: {
        amount: 200,
        destination: 'meltQuote',
        meltTarget: 'alice@example.com',
        recipientPubkey,
      },
    });
    expect((lastHandler.data as { candidates: unknown[] }).candidates).toMatchObject([
      { mintUrl: MINT1, balance: 5000, status: 'available', reason: null },
      {
        mintUrl: MINT2,
        balance: 100,
        status: 'disabled',
        reason: { code: 'INSUFFICIENT_BALANCE' },
      },
      {
        mintUrl: MINT3,
        balance: 0,
        status: 'disabled',
        reason: { code: 'INSUFFICIENT_BALANCE' },
      },
    ]);

    await tm.machine.changeMint(MINT1);

    tm.assertStep('navigateToMeltPreview');
    tm.assertContext({
      amount: 200,
      destination: 'meltQuote',
      mintUrl: MINT1,
      meltTarget: 'alice@example.com',
      recipientPubkey,
    });
    lastHandler = tm.handlerCalls[tm.handlerCalls.length - 1];
    expect(lastHandler).toMatchObject({
      step: 'navigateToMeltPreview',
      data: {
        mintUrl: MINT1,
        amount: 200,
        meltTarget: 'alice@example.com',
        recipientPubkey,
      },
    });
  });

  it('chat send-money lightning: opens mint selector when multiple mints can cover the entered amount', async () => {
    const recipientPubkey = 'd'.repeat(64);
    const recipientProfile = {
      displayName: 'Bob',
      avatarUrl: 'https://example.com/bob.png',
      nip05: 'bob@example.com',
    };
    const tm = createTestMachine({
      wallet: {
        trustedMintUrls: [MINT1, MINT2, MINT3],
        mintBalances: { [MINT1]: 5000, [MINT2]: 4000, [MINT3]: 100 },
        preferredMintUrl: MINT3,
        proofAmounts: {
          [MINT1]: [1024, 2048, 512, 256],
          [MINT2]: [1024, 2048, 512],
          [MINT3]: [64, 32, 4],
        },
      },
    });

    await tm.machine.startSendEcash({
      meltTarget: 'bob@example.com',
      recipientPubkey,
      recipientProfile,
    });
    tm.assertStep('enterAmount');
    tm.assertContext({ mintUrl: MINT3 });

    await tm.machine.enterAmount(1000, MINT3, {
      destination: 'meltQuote',
      meltTarget: 'bob@example.com',
      recipientPubkey,
      recipientProfile,
    });

    tm.assertStep('selectMint');
    tm.assertContext({
      amount: 1000,
      destination: 'meltQuote',
      mintUrl: MINT3,
      meltTarget: 'bob@example.com',
      recipientPubkey,
      recipientProfile,
    });
    const lastHandler = tm.handlerCalls[tm.handlerCalls.length - 1];
    expect(lastHandler).toMatchObject({
      step: 'selectMint',
      data: {
        amount: 1000,
        destination: 'meltQuote',
        meltTarget: 'bob@example.com',
        recipientPubkey,
        recipientProfile,
      },
    });
    expect((lastHandler.data as { candidates: unknown[] }).candidates).toMatchObject([
      { mintUrl: MINT1, balance: 5000, status: 'available', reason: null },
      { mintUrl: MINT2, balance: 4000, status: 'available', reason: null },
      {
        mintUrl: MINT3,
        balance: 100,
        status: 'disabled',
        reason: { code: 'INSUFFICIENT_BALANCE' },
      },
    ]);
  });
});

/**
 * startReceiveLightning() always routes to enterAmount because receiving
 * via Lightning always needs an amount (how much to receive). The mint
 * is pre-selected from preferences.
 */
describe('manual entry — startReceiveLightning', () => {
  it('routes to enterAmount with mintQuote destination', async () => {
    const tm = createTestMachine();
    await tm.machine.startReceiveLightning();
    tm.assertStep('enterAmount');
    // destination='mintQuote' identifies this as a receive flow
    tm.assertContext({ destination: 'mintQuote' });
  });

  it('preselects preferred mint', async () => {
    // WALLETS.default has preferredMintUrl=MINT1
    const tm = createTestMachine();
    await tm.machine.startReceiveLightning();
    tm.assertContext({ mintUrl: MINT1 });
  });
});

/**
 * startReceive() is the simplest entry point — it just navigates to the
 * receive hub screen. No amount, no mint, no payment logic.
 */
describe('manual entry — startReceive', () => {
  it('routes to navigateToReceive', async () => {
    const tm = createTestMachine();
    await tm.machine.startReceive();
    tm.assertStep('navigateToReceive');
  });
});

// ---------------------------------------------------------------------------
// Manual send → full flow
// ---------------------------------------------------------------------------

/**
 * Table-driven scenarios for complete manual entry flows:
 *   - Happy path: startSendEcash → enterAmount → sendComplete
 *   - Mint selection: no preferred → selectMint → enterAmount → sendComplete
 *   - Receive: startReceiveLightning → enterAmount → mintQuoteCreated
 */

const MANUAL_SEND_FULL: FlowScenario = {
  name: 'manual send: startSendEcash → enterAmount → sendComplete',
  steps: [
    // Step 0: User taps Send → auto-selects MINT1 → enterAmount
    { type: 'startSendEcash' },
    // Step 1: User enters 200 sats → confirmSend auto-resolves → sendComplete
    { type: 'enterAmount', amount: 200, mintUrl: MINT1 },
  ],
  expect: {
    step: 'sendComplete',
    context: { amount: 200, mintUrl: MINT1, destination: 'sendEcash' },
  },
};

const MANUAL_SEND_MINT_SELECT: FlowScenario = {
  name: 'manual send: no preferred → selectMint → enterAmount → sendComplete',
  // No preferred mint → machine shows mint picker first
  wallet: { ...WALLETS.default, preferredMintUrl: undefined },
  steps: [
    // Step 0: Start send → selectMint (no preferred)
    { type: 'startSendEcash' },
    // Step 1: User picks MINT1 from the picker
    { type: 'changeMint', mintUrl: MINT1 },
    // Step 2: User enters amount → sendComplete
    { type: 'enterAmount', amount: 100, mintUrl: MINT1 },
  ],
  waypoints: [
    // After starting with no preferred, we should be at selectMint
    { afterStep: 0, step: 'selectMint' },
  ],
  expect: {
    step: 'sendComplete',
    context: { mintUrl: MINT1 },
  },
};

const MANUAL_RECEIVE_FULL: FlowScenario = {
  name: 'manual receive: startReceiveLightning → enterAmount → mintQuoteCreated',
  steps: [
    // Step 0: User taps Receive → Lightning → enterAmount
    { type: 'startReceiveLightning' },
    // Step 1: User enters 5000 sats → createMintQuote auto-resolves → mintQuoteCreated
    { type: 'enterAmount', amount: 5000, mintUrl: MINT1 },
  ],
  expect: {
    step: 'mintQuoteCreated',
    context: { amount: 5000, destination: 'mintQuote' },
  },
};

describe('manual entry — table-driven scenarios', () => {
  it.each([
    MANUAL_SEND_FULL,
    MANUAL_SEND_MINT_SELECT,
    MANUAL_RECEIVE_FULL,
  ])('$name', async (scenario) => {
    await runScenario(scenario);
  });
});

// ---------------------------------------------------------------------------
// enterAmount with destination parameter (direct navigation)
// ---------------------------------------------------------------------------

/**
 * enterAmount() can be called with an explicit destination parameter,
 * bypassing the normal startSendEcash/startReceiveLightning entry points.
 * This is used for direct navigation in some UI patterns where the
 * app already knows what kind of flow it wants.
 */
describe('manual entry — enterAmount with destination', () => {
  it('enterAmount with sendEcash destination from idle', async () => {
    const tm = createTestMachine();
    // Call enterAmount directly with destination — no startSendEcash needed
    await tm.machine.enterAmount(100, MINT1, { destination: 'sendEcash' });
    // Should resolve based on the destination context
    expect(tm.machine.getStep()).not.toBe('idle');
    tm.assertContext({ amount: 100, mintUrl: MINT1 });
  });

  it('enterAmount with mintQuote destination from idle', async () => {
    const tm = createTestMachine();
    // Direct mint quote creation — no startReceiveLightning needed
    await tm.machine.enterAmount(1000, MINT1, { destination: 'mintQuote' });
    // Should auto-execute the mint quote operation → mintQuoteCreated
    tm.assertStep('mintQuoteCreated');
  });

  it('enterAmount with meltQuote destination from idle selects a spendable mint when none was provided', async () => {
    const tm = createTestMachine({ wallet: WALLETS.multiMintUnbalanced });

    await tm.machine.enterAmount(200, '', {
      destination: 'meltQuote',
      meltTarget: 'carol@example.com',
    });

    tm.assertStep('navigateToMeltPreview');
    tm.assertContext({
      amount: 200,
      destination: 'meltQuote',
      mintUrl: MINT1,
      meltTarget: 'carol@example.com',
    });
  });
});
