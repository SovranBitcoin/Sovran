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

import { describe, it, expect, vi } from 'vitest';
import { createTestMachine, runScenario } from '../_harness';
import { WALLETS, MINT1, MINT2 } from '../_harness/fixtures';
import type { FlowScenario, HandlerCall } from '../_harness/types';
import { createDefaultScreenActionHandlers } from '../../src/screen-actions/defaultHandlers';
import { createScreenActionManager } from '../../src/screen-actions/createManager';
import type {
  ScreenActionContext,
  ScreenActionManager,
} from '../../src/screen-actions/types';
import type { PaymentMachine } from '../../src/machine/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function mintQuoteResult(id: string) {
  return {
    historyEntry: JSON.stringify({
      id,
      type: 'mint',
      createdAt: 1,
      mintUrl: MINT1,
      unit: 'sat',
      quoteId: id,
      state: 'UNPAID',
      amount: 1000,
      paymentRequest: `lnbc-${id}`,
      metadata: { operationId: id },
    }),
  };
}

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
    await tm.machine.enterAmount({ value: 1000, unit: 'sat' }, MINT1);

    // The machine auto-executed the executeMintQuote operation.
    // Find it in the recording array.
    const opCall = tm.operationCalls.find((c) => c.name === 'executeMintQuote');
    expect(opCall).toBeDefined();
    expect(opCall!.args[0]).toBe(MINT1); // mintUrl
    expect(opCall!.args[1]).toBe(1000); // amount
  });

  it('does not call executeMintQuote while the device is offline', async () => {
    const tm = createTestMachine({ offline: true });

    await tm.machine.startReceiveLightning();
    await tm.machine.enterAmount({ value: 1000, unit: 'sat' }, MINT1);

    tm.assertStep('error');
    tm.assertExecution({ code: 'MINT_QUOTE_FAILED' });
    expect(tm.operationCalls.find((c) => c.name === 'executeMintQuote')).toBeUndefined();
  });
});

describe('mint quote — hung operation recovery', () => {
  it('startReceive({ reset: true }) recovers while executeMintQuote is still pending', async () => {
    const pendingQuote = deferred<ReturnType<typeof mintQuoteResult>>();
    const tm = createTestMachine({
      operations: {
        executeMintQuote: async () => pendingQuote.promise,
      },
    });

    await tm.machine.startReceiveLightning();
    const blockedNext = tm.machine.enterAmount({ value: 1000, unit: 'sat' }, MINT1);
    expect(tm.operationCalls.find((c) => c.name === 'executeMintQuote')).toBeDefined();

    await tm.machine.startReceive({ reset: true });
    tm.assertStep('receiveHub');

    pendingQuote.resolve(mintQuoteResult('late-receive'));
    await blockedNext;

    tm.assertStep('receiveHub');
  });

  it('startSendEcash({ reset: true }) recovers while executeMintQuote is still pending', async () => {
    const pendingQuote = deferred<ReturnType<typeof mintQuoteResult>>();
    const tm = createTestMachine({
      operations: {
        executeMintQuote: async () => pendingQuote.promise,
      },
    });

    await tm.machine.startReceiveLightning();
    const blockedNext = tm.machine.enterAmount({ value: 1000, unit: 'sat' }, MINT1);

    await tm.machine.startSendEcash({ reset: true });
    tm.assertStep('enterAmount');
    tm.assertContext({ destination: 'sendEcash' });

    pendingQuote.resolve(mintQuoteResult('late-send'));
    await blockedNext;

    tm.assertStep('enterAmount');
    tm.assertContext({ destination: 'sendEcash' });
  });

  it('startReceiveLightning({ reset: true }) recovers while executeMintQuote is still pending', async () => {
    const pendingQuote = deferred<ReturnType<typeof mintQuoteResult>>();
    const tm = createTestMachine({
      operations: {
        executeMintQuote: async () => pendingQuote.promise,
      },
    });

    await tm.machine.startReceiveLightning();
    const blockedNext = tm.machine.enterAmount({ value: 1000, unit: 'sat' }, MINT1);

    await tm.machine.startReceiveLightning({ reset: true });
    tm.assertStep('enterAmount');
    tm.assertContext({ destination: 'mintQuote' });

    pendingQuote.resolve(mintQuoteResult('late-fixed-amount'));
    await blockedNext;

    tm.assertStep('enterAmount');
    tm.assertContext({ destination: 'mintQuote' });
  });
});

// ---------------------------------------------------------------------------
// startReceive — the receive hub (method chooser)
// ---------------------------------------------------------------------------

/**
 * startReceive() navigates to the receive hub — the method chooser
 * (QR Display / Scan QR / Fixed Amount / Paste). It's a simple navigation
 * action — no payment logic, just routing.
 */
describe('startReceive', () => {
  it('routes to receiveHub', async () => {
    const tm = createTestMachine();
    await tm.machine.startReceive();
    tm.assertStep('receiveHub');
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
    await tm.machine.enterAmount({ value: 1000, unit: 'sat' }, MINT1);
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
    await tm.machine.enterAmount({ value: 1000, unit: 'sat' }, MINT1);
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
    await tm.machine.enterAmount({ value: 1000, unit: 'sat' }, MINT1);
    tm.assertStep('mintQuoteCreated');

    const opCall = tm.operationCalls.find((c) => c.name === 'executeMintQuote');
    expect(opCall).toBeTruthy();
    const historyEntry = (opCall!.result as Record<string, unknown>).historyEntry as string;
    const parsed = JSON.parse(historyEntry);
    expect(parsed.type).toBe('mint');
    expect(typeof parsed.id).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Notification timeline
// ---------------------------------------------------------------------------

/**
 * Mint quote fires a single notification on success: onTransactionCreated
 * with type='mint'. There is no processing/confirmed pair — that pattern
 * is reserved for melt and payment request flows where there's a two-phase
 * lifecycle (processing → confirmed/failed).
 *
 * Compare with:
 *   - ecash send:      onTransactionCreated (type=send)
 *   - lightning melt:  onPaymentProcessing → onPaymentConfirmed → onTransactionCreated → onMeltQuoteCreated
 *   - payment request: onPaymentProcessing → onPaymentConfirmed → onTransactionCreated
 *   - mint quote:      onTransactionCreated (type=mint) ← this file
 */
describe('mint quote — notification timeline', () => {
  it('fires only onTransactionCreated on success', async () => {
    const tm = createTestMachine();
    await tm.machine.startReceiveLightning();
    await tm.machine.enterAmount({ value: 1000, unit: 'sat' }, MINT1);
    tm.assertStep('mintQuoteCreated');

    const keys = tm.notificationCalls.map((c) => c.key);
    expect(keys).toEqual(['onTransactionCreated']);
  });

  it('onTransactionCreated carries type=mint with mintUrl, amount, unit, transactionId', async () => {
    const tm = createTestMachine();
    await tm.machine.startReceiveLightning();
    await tm.machine.enterAmount({ value: 1000, unit: 'sat' }, MINT1);

    const txCreated = tm.notificationCalls.find((c) => c.key === 'onTransactionCreated');
    expect(txCreated!.data).toMatchObject({
      type: 'mint',
      mintUrl: MINT1,
      amount: 1000,
      unit: 'sat',
      transactionId: expect.any(String),
    });
  });

  it('does not fire onPaymentProcessing or onPaymentConfirmed (melt/PR only)', async () => {
    const tm = createTestMachine();
    await tm.machine.startReceiveLightning();
    await tm.machine.enterAmount({ value: 1000, unit: 'sat' }, MINT1);

    const keys = tm.notificationCalls.map((c) => c.key);
    expect(keys).not.toContain('onPaymentProcessing');
    expect(keys).not.toContain('onPaymentConfirmed');
  });

  it('fires MINT_QUOTE_FAILED error notification on failure', async () => {
    const tm = createTestMachine({
      operations: {
        executeMintQuote: async () => { throw new Error('Mint offline'); },
      },
    });
    await tm.machine.startReceiveLightning();
    await tm.machine.enterAmount({ value: 1000, unit: 'sat' }, MINT1);
    tm.assertStep('error');

    const keys = tm.notificationCalls.map((c) => c.key);
    expect(keys).toContain('MINT_QUOTE_FAILED');
  });

  it('fires no onTransactionCreated on failure', async () => {
    const tm = createTestMachine({
      operations: {
        executeMintQuote: async () => { throw new Error('Mint offline'); },
      },
    });
    await tm.machine.startReceiveLightning();
    await tm.machine.enterAmount({ value: 1000, unit: 'sat' }, MINT1);

    const keys = tm.notificationCalls.map((c) => c.key);
    expect(keys).not.toContain('onTransactionCreated');
  });
});

// ---------------------------------------------------------------------------
// Fixed Amount — end-to-end through the REAL amountEntry screen action
//
// Drives the whole "Receive → Fixed Amount → type an amount → Next → <variant>"
// path the way the app does: the machine's enterAmount step feeds an entrySeed
// into a REAL screen-action manager (default handlers + amountConfig), the
// keypad amount is typed via setInput, and Next fires through the real
// amountEntry.next handler back into the SAME machine.
//
// This is the wallet-level reproduction harness for the Fixed-Amount bug. It
// nails the invariant that governs where each variant delivers its result —
// EVERY variant now advances the machine to a terminal step the app navigates
// off (a step handler, never a side-channel callback):
//   • lightning / plain → mintQuoteCreated (executeMintQuote);
//   • ecash → paymentRequestReceived (createPaymentRequestReceive) — the lane
//     added to fix "as Ecash" doing nothing (it used to hop to the screen via
//     a navigate() callback that silently no-op'd).
// ---------------------------------------------------------------------------

function buildAmountEntrySeed(stepData: unknown): Record<string, unknown> {
  const data = stepData as {
    unit: string;
    preselectedMintUrl?: string;
    constraints?: { destination?: string; methodContext?: unknown };
  };
  const constraints = data.constraints ?? {};
  return {
    destination: constraints.destination,
    unit: data.unit,
    selectedMintUrl: data.preselectedMintUrl ?? '',
    ...(constraints.methodContext ? { methodContext: constraints.methodContext } : {}),
  };
}

interface WiredAmount {
  mgr: ScreenActionManager<'amountEntry'>;
}

function wireRealAmountScreen(
  machine: PaymentMachine,
  entrySeed: Record<string, unknown>,
  proofAmounts: Record<string, number[]>,
): WiredAmount {
  const handlers = createDefaultScreenActionHandlers({
    getMachine: () => machine,
    getOperations: () => ({}),
    notify: () => {},
    navigation: {},
  });

  let mgrRef: ScreenActionManager<'amountEntry'> | null = null;
  const mgr = createScreenActionManager<'amountEntry'>({
    screenType: 'amountEntry',
    handlers: {},
    defaultHandlers: handlers.amountEntry,
    getContext: (): ScreenActionContext => ({
      entry: mgrRef?.getEntry() ?? {},
      manager: null,
      setEntry: (e: Record<string, unknown>) => mgrRef?.setEntry(e),
    }),
    amountConfig: {
      getMintUrl: () => machine.getContext().mintUrl,
      getProofAmounts: () => {
        const mint = machine.getContext().mintUrl;
        return mint ? (proofAmounts[mint] ?? []) : [];
      },
      getBtcPrice: () => 0,
      offlineOptimization: () => machine.getContext().destination === 'sendEcash',
      unit: () => machine.getContext().unit,
    },
  });
  mgrRef = mgr;
  mgr.setEntry(entrySeed);
  return { mgr };
}

async function openFixedAmount(): Promise<{
  tm: ReturnType<typeof createTestMachine>;
  wired: WiredAmount;
}> {
  const tm = createTestMachine();
  await tm.machine.startReceiveLightning({ reset: true });
  expect(tm.machine.getStep()).toBe('enterAmount');
  const call = tm.handlerCalls.find((c) => c.step === 'enterAmount') as HandlerCall;
  const seed = buildAmountEntrySeed(call.data);
  const wired = wireRealAmountScreen(tm.machine, seed, WALLETS.default.proofAmounts);
  // Type 100 (setInput replaces the whole raw string, mirroring CustomKeyboard).
  await wired.mgr.execute('setInput', { input: '100' });
  return { tm, wired };
}

describe('Fixed Amount — end-to-end amountEntry.next', () => {
  it('offers both ecash and lightning variants once an amount is entered', async () => {
    const { wired } = await openFixedAmount();
    const next = wired.mgr.inspect().next;
    expect(next.available).toBe(true);
    const ids = Object.fromEntries(
      (next.variants ?? []).map((v) => [v.id, v.available]),
    );
    expect(ids.ecash).toBe(true);
    expect(ids.lightning).toBe(true);
  });

  it('Next → "as Lightning" advances the machine to mintQuoteCreated', async () => {
    const { tm, wired } = await openFixedAmount();
    await wired.mgr.execute('next', { variantId: 'lightning' });
    expect(tm.machine.getStep()).toBe('mintQuoteCreated');
    expect(tm.operationCalls.find((c) => c.name === 'executeMintQuote')).toBeDefined();
  });

  it('Next → "as Ecash" advances the machine to paymentRequestReceived', async () => {
    const { tm, wired } = await openFixedAmount();
    await wired.mgr.execute('next', { variantId: 'ecash' });

    // The machine drove the receive-request lane (auto-exec) to its terminal
    // display step — the app navigates off THIS step handler, not a callback.
    expect(tm.machine.getStep()).toBe('paymentRequestReceived');

    const opCall = tm.operationCalls.find((c) => c.name === 'createPaymentRequestReceive');
    expect(opCall).toBeDefined();
    expect(opCall!.args[0]).toEqual({ amount: 100, unit: 'sat' });
    // Ecash must not mint a Lightning quote.
    expect(tm.operationCalls.find((c) => c.name === 'executeMintQuote')).toBeUndefined();

    // The terminal step carries the encoded request the display screen renders.
    const handlerCall = tm.handlerCalls.find((c) => c.step === 'paymentRequestReceived');
    expect(handlerCall).toBeDefined();
    const entry = JSON.parse((handlerCall!.data as { entry: string }).entry);
    expect(entry).toMatchObject({ amount: 100, unit: 'sat', operationId: 'pr-op-1' });
  });
});
