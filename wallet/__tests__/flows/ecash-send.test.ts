/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ecash-send.test.ts — Ecash Send Flow
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests the "send ecash" flow — where the user creates an ecash token to
 * send to someone. This flow is triggered by:
 *   1. User taps "Send" button → startSendEcash()
 *   2. User enters amount + selects mint
 *   3. Machine creates the token and completes
 *
 * The flow goes through these steps:
 *   startSendEcash → enterAmount → confirmSend → sendComplete
 *
 * IMPORTANT: confirmSend is an AUTO-EXECUTION step. The machine wrapper
 * automatically calls executeSend() when it reaches confirmSend, then
 * transitions to sendComplete. In tests using createTestMachine, you'll
 * never see confirmSend as the current step — it auto-resolves.
 *
 * Variations tested:
 *   - Happy path: preferred mint → enterAmount → sendComplete
 *   - No preferred mint: → selectMint (user must choose)
 *   - No balance: → error (can't send with nothing)
 *   - No mints: → error (no mint to create token from)
 *   - Change mint mid-flow: requestMintSelector → changeMint → continue
 *   - Non-exact proofs (online): → sendComplete (mint swaps server-side)
 *   - Non-exact proofs (online, send fails): → chooseProofs fallback
 *   - Offline exact proofs: → sendComplete through executeOfflineSend
 *   - Offline non-exact proofs: → chooseProofs
 *   - Insufficient balance: → mint selector first, then chooseProofs fallback
 */

import { describe, it, expect } from 'vitest';
import { createTestMachine, runScenario } from '../_harness';
import { WALLETS, MINT1, MINT2, MINT3 } from '../_harness/fixtures';
import type { FlowScenario } from '../_harness/types';

// ---------------------------------------------------------------------------
// startSendEcash — direct entry
// ---------------------------------------------------------------------------

/**
 * startSendEcash() is called when the user taps the "Send" button directly
 * (not from scanning/pasting). The machine must decide:
 *   1. Which mint to use (auto-select preferred, or ask user)
 *   2. Whether the wallet can send at all (has balance? has mints?)
 */
describe('ecash send — startSendEcash', () => {
  it('routes to enterAmount with preferred mint pre-selected', async () => {
    // WALLETS.default has preferredMintUrl=MINT1 with 1000 sat balance.
    // The machine skips mint selection and goes straight to amount entry.
    const tm = createTestMachine();
    await tm.machine.startSendEcash();
    tm.assertStep('enterAmount');
    // destination='sendEcash' distinguishes from mintQuote/melt flows
    // mintUrl=MINT1 is pre-selected from preferences
    tm.assertContext({ destination: 'sendEcash', mintUrl: MINT1 });
  });

  it('routes to selectMint when no preferred mint', async () => {
    // User has 2 mints but no preference → must choose which mint to send from
    const tm = createTestMachine({
      wallet: { preferredMintUrl: undefined },
    });
    await tm.machine.startSendEcash();
    tm.assertStep('selectMint');
  });

  it('routes to error when no balance', async () => {
    // WALLETS.noBalance has a trusted mint but 0 balance → can't send
    const tm = createTestMachine({ wallet: WALLETS.noBalance });
    await tm.machine.startSendEcash();
    tm.assertStep('error');
  });

  it('routes to error when no mints', async () => {
    // WALLETS.noMints has no trusted mints → nowhere to create a token
    const tm = createTestMachine({ wallet: WALLETS.noMints });
    await tm.machine.startSendEcash();
    tm.assertStep('error');
  });
});

// ---------------------------------------------------------------------------
// Full ecash send flow — happy path
// ---------------------------------------------------------------------------

/**
 * Table-driven scenarios define complete multi-step flows declaratively.
 * Each scenario specifies:
 *   - steps: the sequence of user actions
 *   - waypoints: intermediate assertions (checked after each step)
 *   - expect: the final expected state
 *
 * The runScenario() helper executes each step, checks waypoints, and
 * asserts the final state.
 */

const ECASH_SEND_HAPPY: FlowScenario = {
  name: 'ecash send happy path: start → amount → sendComplete',
  steps: [
    // Step 0: User taps Send → machine auto-selects preferred mint
    { type: 'startSendEcash' },
    // Step 1: User enters 100 sats → machine auto-executes send → sendComplete
    { type: 'enterAmount', amount: 100, mintUrl: MINT1 },
  ],
  waypoints: [
    // After step 0, we should be at enterAmount (waiting for user input)
    { afterStep: 0, step: 'enterAmount' },
  ],
  expect: {
    // After step 1, confirmSend auto-resolves to sendComplete
    step: 'sendComplete',
    context: { amount: 100, mintUrl: MINT1, destination: 'sendEcash' },
  },
};

const ECASH_SEND_CHANGE_MINT: FlowScenario = {
  name: 'ecash send: request mint selector during enterAmount',
  steps: [
    // Step 0: Start send flow → enterAmount with MINT1 pre-selected
    { type: 'startSendEcash' },
    // Step 1: User taps mint selector button → opens mint picker
    { type: 'requestMintSelector', scope: 'selected' },
    // Step 2: User picks MINT2 instead of MINT1
    { type: 'changeMint', mintUrl: MINT2 },
    // Step 3: User enters amount with the newly selected MINT2
    { type: 'enterAmount', amount: 100, mintUrl: MINT2 },
  ],
  waypoints: [
    { afterStep: 0, step: 'enterAmount' },
    // After requesting mint selector, we're in the selectMint step
    { afterStep: 1, step: 'selectMint' },
  ],
  expect: {
    step: 'sendComplete',
    // MINT2 should be the selected mint, not MINT1
    context: { mintUrl: MINT2 },
  },
};

const ECASH_SEND_NO_EXACT_PROOFS: FlowScenario = {
  name: 'ecash send: non-exact proof amount online → sendComplete (mint swaps)',
  // WALLETS.noExactProofs has proofs [512, 256, 128, 64, 32, 8] = 1000 total
  // but can't compose exactly 100 (closest: 96=64+32 or 104=64+32+8).
  // When ONLINE, the mint handles swaps server-side via executeSend,
  // so the proof selector is skipped entirely.
  wallet: WALLETS.noExactProofs,
  steps: [
    { type: 'startSendEcash' },
    { type: 'enterAmount', amount: 100, mintUrl: MINT1 },
  ],
  expect: {
    step: 'sendComplete',
  },
};

const ECASH_SEND_OFFLINE: FlowScenario = {
  name: 'ecash send: offline exact proofs create token without proof selector',
  // When offline and local proofs can compose the requested amount exactly,
  // the machine creates the token directly through executeOfflineSend.
  offline: true,
  steps: [
    { type: 'startSendEcash' },
    { type: 'enterAmount', amount: 100, mintUrl: MINT1 },
  ],
  expect: {
    step: 'sendComplete',
  },
};

describe('ecash send — table-driven scenarios', () => {
  it.each([
    ECASH_SEND_HAPPY,
    ECASH_SEND_CHANGE_MINT,
    ECASH_SEND_NO_EXACT_PROOFS,
    ECASH_SEND_OFFLINE,
  ])('$name', async (scenario) => {
    await runScenario(scenario);
  });
});

describe('ecash send — optional memo flow', () => {
  it('pauses before token creation and passes the trimmed memo to executeSend when enabled', async () => {
    const tm = createTestMachine({
      wallet: WALLETS.noExactProofs,
      enableEcashSendMemo: true,
    });

    await tm.machine.startSendEcash();
    await tm.machine.enterAmount(100, MINT1);

    tm.assertStep('enterSendMemo');
    expect(tm.operationCalls.some((call) => call.name === 'executeSend')).toBe(false);

    await tm.machine.submitSendMemo('  lunch  ');

    tm.assertStep('sendComplete');
    const sendCall = tm.operationCalls.find((call) => call.name === 'executeSend');
    expect(sendCall?.args).toEqual([MINT1, 100, 'lunch']);
    const entry = JSON.parse(
      (sendCall?.result as { historyEntry: string }).historyEntry
    ) as { token?: { memo?: string } };
    expect(entry.token?.memo).toBe('lunch');
    tm.assertContext({ memo: 'lunch', sendMemoHandled: true });
  });

  it('treats a blank memo as skipped', async () => {
    const tm = createTestMachine({
      wallet: WALLETS.noExactProofs,
      enableEcashSendMemo: true,
    });

    await tm.machine.startSendEcash();
    await tm.machine.enterAmount(100, MINT1);
    await tm.machine.submitSendMemo('   ');

    tm.assertStep('sendComplete');
    const sendCall = tm.operationCalls.find((call) => call.name === 'executeSend');
    expect(sendCall?.args).toEqual([MINT1, 100]);
    tm.assertContext({ sendMemoHandled: true });
    expect(tm.machine.getContext().memo).toBeUndefined();
  });

  it('asks for a memo after offline proof fallback selection before creating the token', async () => {
    const tm = createTestMachine({
      wallet: WALLETS.noExactProofs,
      offline: true,
      enableEcashSendMemo: true,
    });

    await tm.machine.startSendEcash();
    await tm.machine.enterAmount(100, MINT1);
    tm.assertStep('chooseProofs');

    await tm.machine.chooseProofs(96);
    tm.assertStep('enterSendMemo');

    await tm.machine.submitSendMemo('offline handoff');
    tm.assertStep('sendComplete');
    const offlineCall = tm.operationCalls.find((call) => call.name === 'executeOfflineSend');
    expect(offlineCall?.args).toEqual([MINT1, 96, 'offline handoff']);
  });
});

// ---------------------------------------------------------------------------
// Proof selection flow
// ---------------------------------------------------------------------------

/**
 * When the proof picker is shown (chooseProofs step), the user selects
 * an amount that CAN be composed from available proofs. This amount may
 * be less than what they originally entered.
 *
 * After choosing proofs, the flow continues to sendComplete. The final
 * amount in context should reflect the chosen proof amount, not the
 * original entered amount.
 */
describe('ecash send — proof selection', () => {
  it('offline + non-exact proofs → chooseProofs', async () => {
    const tm = createTestMachine({ wallet: WALLETS.noExactProofs, offline: true });
    await tm.machine.startSendEcash();
    await tm.machine.enterAmount(100, MINT1);

    tm.assertStep('chooseProofs');
    const lastHandler = tm.handlerCalls[tm.handlerCalls.length - 1];
    expect(lastHandler).toMatchObject({
      step: 'chooseProofs',
      data: {
        amount: 100,
        suggestions: {
          roundDown: { amount: 96 },
          roundUp: { amount: 104 },
        },
      },
    });
  });

  it('chooseProofs with round-down amount → sendComplete', async () => {
    const tm = createTestMachine({ wallet: WALLETS.noExactProofs, offline: true });
    await tm.machine.startSendEcash();
    await tm.machine.enterAmount(100, MINT1);
    tm.assertStep('chooseProofs');

    // User chooses 96 sats (64+32) — the nearest composable amount below 100
    await tm.machine.chooseProofs(96);
    tm.assertStep('sendComplete');
    // The final amount should be 96, not the original 100
    tm.assertContext({ amount: 96 });
  });
});

// ---------------------------------------------------------------------------
// Ecash send with insufficient balance
// ---------------------------------------------------------------------------

/**
 * WALLETS.insufficientBalance has only 50 sats (MINT1). When the user
 * tries to send 9999, the result depends on how the machine handles
 * the over-budget request — it may route to error, stay at enterAmount
 * for correction, or show the proof picker.
 */
describe('ecash send — insufficient balance', () => {
  it('opens mint selector when another mint can cover the entered amount', async () => {
    const tm = createTestMachine({ wallet: WALLETS.multiMintUnbalanced });

    await tm.machine.startSendEcash();
    tm.assertStep('enterAmount');
    tm.assertContext({ mintUrl: MINT2 });

    await tm.machine.enterAmount(200, MINT2);

    tm.assertStep('selectMint');
    tm.assertContext({ amount: 200, mintUrl: MINT2, destination: 'sendEcash' });
    const lastHandler = tm.handlerCalls[tm.handlerCalls.length - 1];
    expect(lastHandler).toMatchObject({
      step: 'selectMint',
      data: {
        candidates: [{ mintUrl: MINT1, balance: 5000 }],
        amount: 200,
        destination: 'sendEcash',
      },
    });
  });

  it('opens the mint selector when multiple mints can cover the entered amount', async () => {
    const tm = createTestMachine({
      wallet: {
        trustedMintUrls: [MINT1, MINT2, MINT3],
        mintBalances: { [MINT1]: 5000, [MINT2]: 4000, [MINT3]: 100 },
        preferredMintUrl: MINT3,
        proofAmounts: {
          [MINT1]: [2048, 1024, 512],
          [MINT2]: [2048, 1024, 512],
          [MINT3]: [64, 32, 4],
        },
      },
    });

    await tm.machine.startSendEcash();
    tm.assertStep('enterAmount');
    tm.assertContext({ mintUrl: MINT3 });

    await tm.machine.enterAmount(1000, MINT3);

    tm.assertStep('selectMint');
    tm.assertContext({ amount: 1000, mintUrl: MINT3, destination: 'sendEcash' });
    const lastHandler = tm.handlerCalls[tm.handlerCalls.length - 1];
    expect(lastHandler).toMatchObject({
      step: 'selectMint',
      data: {
        amount: 1000,
        destination: 'sendEcash',
      },
    });
    expect((lastHandler.data as { candidates: unknown[] }).candidates).toEqual([
      { mintUrl: MINT1, balance: 5000 },
      { mintUrl: MINT2, balance: 4000 },
    ]);
  });

  it('selects a sufficient mint when amount entry provides no mintUrl', async () => {
    const tm = createTestMachine({ wallet: WALLETS.multiMintUnbalanced });

    await tm.machine.enterAmount(200, '', { destination: 'sendEcash' });

    tm.assertStep('sendComplete');
    tm.assertContext({ amount: 200, mintUrl: MINT1, destination: 'sendEcash' });
    const opCall = tm.operationCalls.find((c) => c.name === 'executeSend');
    expect(opCall?.args).toEqual([MINT1, 200]);
  });

  it('shows chooseProofs with a real round-down when amount exceeds all mints', async () => {
    const tm = createTestMachine({ wallet: WALLETS.insufficientBalance });
    await tm.machine.startSendEcash();
    await tm.machine.enterAmount(9999, MINT1);
    tm.assertStep('chooseProofs');
    tm.assertContext({ amount: 9999, mintUrl: MINT1, destination: 'sendEcash' });
    const lastHandler = tm.handlerCalls[tm.handlerCalls.length - 1];
    expect(lastHandler).toMatchObject({
      step: 'chooseProofs',
      data: {
        suggestions: {
          roundDown: { amount: 50 },
          roundUp: null,
        },
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Online executeSend fallback — proof selector on failure
// ---------------------------------------------------------------------------

/**
 * When exact local proofs exist, the machine creates the token locally first.
 * Non-exact online sends still attempt executeSend and can fall back to
 * chooseProofs when the mint is unreachable.
 */
describe('ecash send — online executeSend fallback', () => {
  function mintFetchError(): Error {
    const err = new Error('Mint unreachable');
    err.name = 'MintFetchError';
    return err;
  }

  it('online + non-exact proofs + send succeeds → sendComplete', async () => {
    const tm = createTestMachine({ wallet: WALLETS.noExactProofs });
    await tm.machine.startSendEcash();
    await tm.machine.enterAmount(100, MINT1);
    // Online: executeSend succeeds, proof selector is skipped
    tm.assertStep('sendComplete');
  });

  it('online + exact proofs → local-first offline send without executeSend', async () => {
    const tm = createTestMachine();
    await tm.machine.startSendEcash();
    await tm.machine.enterAmount(100, MINT1);

    tm.assertStep('sendComplete');
    expect(tm.operationCalls.map((call) => call.name)).toContain('executeOfflineSend');
    expect(tm.operationCalls.map((call) => call.name)).not.toContain('executeSend');
    expect(tm.handlerCalls[tm.handlerCalls.length - 1]).toMatchObject({
      step: 'sendComplete',
      data: {
        createdOffline: true,
      },
    });
    expect(tm.handlerCalls[tm.handlerCalls.length - 1].data).not.toMatchObject({
      mintWasOffline: true,
    });
  });

  it('online + non-exact proofs + send fails → chooseProofs fallback', async () => {
    const tm = createTestMachine({
      wallet: WALLETS.noExactProofs,
      operations: {
        executeSend: async () => { throw new Error('Mint unreachable'); },
      },
    });
    await tm.machine.startSendEcash();
    await tm.machine.enterAmount(100, MINT1);
    // executeSend failed, proofs exist with composition options → chooseProofs
    tm.assertStep('chooseProofs');
    const lastHandler = tm.handlerCalls[tm.handlerCalls.length - 1];
    expect(lastHandler).toMatchObject({
      step: 'chooseProofs',
      data: {
        suggestions: {
          roundDown: { amount: 96 },
          roundUp: { amount: 104 },
        },
      },
    });
  });

  it('local proof choice after mint failure does not retry executeSend', async () => {
    const tm = createTestMachine({
      wallet: WALLETS.noExactProofs,
      operations: {
        executeSend: async () => {
          throw mintFetchError();
        },
      },
    });
    await tm.machine.startSendEcash();
    await tm.machine.enterAmount(100, MINT1);
    tm.assertStep('chooseProofs');

    await tm.machine.chooseProofs(96);

    tm.assertStep('sendComplete');
    const executeSendCalls = tm.operationCalls.filter((call) => call.name === 'executeSend');
    expect(executeSendCalls).toHaveLength(1);
    const offlineSendCall = tm.operationCalls.find((call) => call.name === 'executeOfflineSend');
    expect(offlineSendCall?.args).toEqual([MINT1, 96]);
    expect(tm.handlerCalls[tm.handlerCalls.length - 1]).toMatchObject({
      step: 'sendComplete',
      data: { mintWasOffline: true },
    });
  });

  it('online + exact proofs + send fails → error without same-amount fallback', async () => {
    const tm = createTestMachine({
      operations: {
        executeOfflineSend: async () => {
          throw new Error('Local proof composition failed');
        },
        executeSend: async () => { throw new Error('Mint unreachable'); },
      },
    });
    await tm.machine.startSendEcash();
    await tm.machine.enterAmount(100, MINT1);
    tm.assertStep('error');
  });

  it('offline + exact proofs → sendComplete through executeOfflineSend', async () => {
    const tm = createTestMachine({ offline: true });
    await tm.machine.startSendEcash();
    await tm.machine.enterAmount(100, MINT1);
    tm.assertStep('sendComplete');
    expect(tm.operationCalls.map((call) => call.name)).toContain('executeOfflineSend');
    expect(tm.handlerCalls[tm.handlerCalls.length - 1]).toMatchObject({
      step: 'sendComplete',
      data: expect.objectContaining({ createdOffline: true }),
    });
    expect(tm.handlerCalls[tm.handlerCalls.length - 1].data).not.toMatchObject({
      mintWasOffline: true,
    });
  });

  it('offline flag propagates through startSendEcash flow context', async () => {
    // Simulates mock offline mode: getOffline() returns true from the start.
    // The offline flag should persist through startSendEcash → enterAmount
    // and still allow an exact local offline token without proof selection.
    const tm = createTestMachine({ offline: true });
    await tm.machine.startSendEcash();
    // Offline flag should already be on the flow context
    tm.assertContext({ offline: true });
    await tm.machine.enterAmount(100, MINT1);
    tm.assertStep('sendComplete');
    tm.assertContext({ offline: true });
  });
});

// ---------------------------------------------------------------------------
// executeSend — operation and error surface
// ---------------------------------------------------------------------------

/**
 * The confirmSend step auto-executes: unlike melt/payment-request, there
 * is no explicit "confirm" step. The machine calls executeSend() as soon
 * as all prerequisites are met (amount, mint, proofs if offline).
 *
 * These tests verify:
 *   - The operation is called with correct args on success
 *   - The result contains a historyEntry
 *   - Failures with no fallback route to error with SEND_FAILED
 */
describe('ecash send — executeSend operation', () => {
  it('calls executeSend and reaches sendComplete on success', async () => {
    const tm = createTestMachine({ wallet: WALLETS.noExactProofs });
    await tm.machine.startSendEcash();
    await tm.machine.enterAmount(100, MINT1);
    tm.assertStep('sendComplete');

    const opCall = tm.operationCalls.find((c) => c.name === 'executeSend');
    expect(opCall).toBeTruthy();
    expect(opCall!.args).toEqual([MINT1, 100]);
    // Result must contain historyEntry
    expect((opCall!.result as Record<string, unknown>).historyEntry).toEqual(expect.any(String));
  });

  it('routes to error with SEND_FAILED when no fallback proofs', async () => {
    const tm = createTestMachine({
      // Balance covers the amount so the machine's pre-flight mint check
      // passes; empty proofAmounts ensures no chooseProofs fallback so we
      // exercise the executeSend-throws → error mapping.
      wallet: { ...WALLETS.noBalance, mintBalances: { [MINT1]: 1000 } },
      operations: {
        executeSend: async () => {
          throw new Error('Insufficient balance');
        },
      },
    });
    await tm.machine.startSendEcash();
    await tm.machine.enterAmount(100, MINT1);
    tm.assertStep('error');
    tm.assertExecution({ code: 'SEND_FAILED' });
  });
});

// ---------------------------------------------------------------------------
// executeSend — historyEntry data integrity
// ---------------------------------------------------------------------------

/**
 * The historyEntry returned by executeSend is the source of truth for the
 * SendTokenScreen. It must contain a parseable JSON with type and id fields.
 */
describe('ecash send — historyEntry data', () => {
  it('sendComplete result contains parseable historyEntry with id', async () => {
    const tm = createTestMachine();
    await tm.machine.startSendEcash();
    await tm.machine.enterAmount(100, MINT1);
    tm.assertStep('sendComplete');

    const lastHandler = tm.handlerCalls[tm.handlerCalls.length - 1];
    const historyEntry = (lastHandler.data as { historyEntry: string }).historyEntry;
    const parsed = JSON.parse(historyEntry);
    expect(parsed.type).toBe('send');
    expect(typeof parsed.id).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Notification timeline — which notifications fire during ecash send
// ---------------------------------------------------------------------------

/**
 * Ecash send fires a different set of notifications than melt or payment
 * request flows. There is no processing/confirmed pair — the machine
 * executes the send inline and only fires onTransactionCreated on success.
 *
 * Compare with:
 *   - lightning-melt: onPaymentProcessing → onPaymentConfirmed → onTransactionCreated → onMeltQuoteCreated
 *   - payment-request: onPaymentProcessing → onPaymentConfirmed → onTransactionCreated
 *   - ecash send:      onTransactionCreated (only)
 */
describe('ecash send — notification timeline', () => {
  it('fires only onTransactionCreated on success', async () => {
    const tm = createTestMachine();
    await tm.machine.startSendEcash();
    await tm.machine.enterAmount(100, MINT1);
    tm.assertStep('sendComplete');

    const keys = tm.notificationCalls.map((c) => c.key);
    expect(keys).toEqual(['onTransactionCreated']);
  });

  it('onTransactionCreated carries type=send, mintUrl, amount, unit, transactionId', async () => {
    const tm = createTestMachine();
    await tm.machine.startSendEcash();
    await tm.machine.enterAmount(100, MINT1);

    const txCreated = tm.notificationCalls.find((c) => c.key === 'onTransactionCreated');
    expect(txCreated!.data).toMatchObject({
      type: 'send',
      mintUrl: MINT1,
      amount: 100,
      unit: 'sat',
      transactionId: expect.any(String),
    });
  });

  it('does not fire onPaymentProcessing or onPaymentConfirmed (melt/PR only)', async () => {
    const tm = createTestMachine();
    await tm.machine.startSendEcash();
    await tm.machine.enterAmount(100, MINT1);

    const keys = tm.notificationCalls.map((c) => c.key);
    expect(keys).not.toContain('onPaymentProcessing');
    expect(keys).not.toContain('onPaymentConfirmed');
  });

  it('fires no notifications when executeSend fails and falls back to chooseProofs', async () => {
    const tm = createTestMachine({
      wallet: WALLETS.noExactProofs,
      operations: {
        executeSend: async () => { throw new Error('Mint unreachable'); },
      },
    });
    await tm.machine.startSendEcash();
    await tm.machine.enterAmount(100, MINT1);
    tm.assertStep('chooseProofs');

    expect(tm.notificationCalls).toHaveLength(0);
  });

  it('fires SEND_FAILED error notification when send fails with no fallback', async () => {
    const tm = createTestMachine({
      // See the matching test above — give MINT1 balance so the pre-flight
      // mint check passes, while keeping proofAmounts empty so executeSend
      // is the failure source under test.
      wallet: { ...WALLETS.noBalance, mintBalances: { [MINT1]: 1000 } },
      operations: {
        executeSend: async () => { throw new Error('No proofs'); },
      },
    });
    await tm.machine.startSendEcash();
    await tm.machine.enterAmount(100, MINT1);
    tm.assertStep('error');

    const keys = tm.notificationCalls.map((c) => c.key);
    expect(keys).toContain('SEND_FAILED');
  });
});
