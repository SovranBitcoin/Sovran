/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * back-nav-reentry.test.ts — Back-navigation re-entry resilience
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * React Native gives the user a back gesture on nearly every screen, and the
 * machine deliberately receives NO navigation events — the router is free to
 * re-drive any earlier screen while the machine sits in a later state. The
 * machine's contract is therefore:
 *
 *   1. RE-ENTRY UPDATES CONTEXT — an input event that belongs to an earlier
 *      step (e.g. AMOUNT_ENTERED while the machine shows a created quote)
 *      is accepted from ANY step: the new input replaces the old value and
 *      the flow re-resolves forward. No reset required, and context the
 *      user already built (mint choice, recipient, unit) survives.
 *
 *   2. LATEST INTENT WINS OVER IN-FLIGHT RESOLUTION — while a *resolve*
 *      effect (e.g. createMintQuote) is still awaiting the mint, a new
 *      user-intent event supersedes it: the in-flight work is invalidated
 *      via the flow generation (its late result — success OR failure — is
 *      discarded) and the new event is processed immediately. User input
 *      is never silently dropped just because a network call is slow.
 *
 *   3. MONEY MOVEMENT STAYS LOCKED — while a *commit* effect is executing
 *      (ecash send, melt, payment request delivery, NFC write-back), all
 *      events are still dropped. A commit is irreversible; superseding it
 *      would let a user double-spend or abandon a payment mid-flight.
 *
 * Repro that motivated this spec: Receive → Fixed Amount → enter amount →
 * Next → back → enter new amount → Next did nothing, because the first
 * quote's await held `sendLocked` and the second AMOUNT_ENTERED was dropped
 * (`machine.event.ignored reason:locked`).
 */

import { describe, it, expect } from 'vitest';
import { createTestMachine } from '../_harness';
import { MINT1, MINT2 } from '../_harness/fixtures';

function quoteEntry(id: string, amount: number, mintUrl: string = MINT1) {
  return {
    historyEntry: JSON.stringify({
      id,
      type: 'mint',
      createdAt: 1,
      mintUrl,
      unit: 'sat',
      quoteId: id,
      state: 'UNPAID',
      amount,
      paymentRequest: `lnbc-${id}`,
      metadata: { operationId: id },
    }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// 1. Settled re-entry — accepted from any step, context updates
// ---------------------------------------------------------------------------

describe('back-nav re-entry — settled state', () => {
  it('AMOUNT_ENTERED after mintQuoteCreated creates a new quote with the new amount', async () => {
    const tm = createTestMachine();
    await tm.machine.startReceiveLightning({ reset: true });
    await tm.machine.enterAmount({ value: 1000, unit: 'sat' }, MINT1, {
      destination: 'mintQuote',
    });
    tm.assertStep('mintQuoteCreated');

    // back gesture — the machine hears nothing — then the re-driven amount
    // screen submits a new amount
    await tm.machine.enterAmount({ value: 2000, unit: 'sat' }, MINT1, {
      destination: 'mintQuote',
    });

    tm.assertStep('mintQuoteCreated');
    tm.assertContext({ amount: 2000 });
    expect(
      tm.operationCalls.filter((c) => c.name === 'executeMintQuote')
    ).toHaveLength(2);
    // the handler re-navigated for the new quote
    expect(
      tm.handlerCalls.filter((h) => h.step === 'mintQuoteCreated')
    ).toHaveLength(2);
  });

  it('re-entry preserves an in-flow mint choice (context is not reset)', async () => {
    const tm = createTestMachine();
    await tm.machine.startReceiveLightning({ reset: true });
    // user swapped the quote mint mid-flow
    await tm.machine.enterAmount({ value: 1000, unit: 'sat' }, MINT2, {
      destination: 'mintQuote',
    });
    tm.assertStep('mintQuoteCreated');
    tm.assertContext({ mintUrl: MINT2 });

    // back → new amount, screen resubmits with the mint it shows (MINT2)
    await tm.machine.enterAmount({ value: 500, unit: 'sat' }, MINT2, {
      destination: 'mintQuote',
    });
    tm.assertStep('mintQuoteCreated');
    tm.assertContext({ amount: 500, mintUrl: MINT2 });
  });

  it('re-entering via the hub reset path still works', async () => {
    const tm = createTestMachine();
    await tm.machine.startReceiveLightning({ reset: true });
    await tm.machine.enterAmount({ value: 1000, unit: 'sat' }, MINT1, {
      destination: 'mintQuote',
    });
    tm.assertStep('mintQuoteCreated');

    await tm.machine.startReceiveLightning({ reset: true });
    tm.assertStep('enterAmount');
    await tm.machine.enterAmount({ value: 2000, unit: 'sat' }, MINT1, {
      destination: 'mintQuote',
    });
    tm.assertStep('mintQuoteCreated');
    tm.assertContext({ amount: 2000 });
  });
});

// ---------------------------------------------------------------------------
// 2. In-flight supersede — latest intent wins over pending resolution
// ---------------------------------------------------------------------------

describe('back-nav re-entry — supersedes in-flight resolve work', () => {
  it('AMOUNT_ENTERED during a pending createMintQuote is NOT dropped', async () => {
    const first = deferred<{ historyEntry: string }>();
    let calls = 0;
    const tm = createTestMachine({
      operations: {
        executeMintQuote: async (_mint, amount) => {
          calls += 1;
          if (calls === 1) return first.promise; // slow mint
          return quoteEntry(`q${calls}`, amount as number);
        },
      },
    });

    await tm.machine.startReceiveLightning({ reset: true });
    const firstPress = tm.machine.enterAmount({ value: 1000, unit: 'sat' }, MINT1, {
      destination: 'mintQuote',
    });

    // user backs out while the mint is slow and submits a new amount
    await tm.machine.enterAmount({ value: 2000, unit: 'sat' }, MINT1, {
      destination: 'mintQuote',
    });

    // the second press took over: new quote created for 2000
    tm.assertStep('mintQuoteCreated');
    tm.assertContext({ amount: 2000 });
    expect(calls).toBe(2);

    // the slow first quote finally lands — it must be discarded, not navigate
    const handlerCallsBefore = tm.handlerCalls.length;
    first.resolve(quoteEntry('q1', 1000));
    await firstPress;
    tm.assertStep('mintQuoteCreated');
    tm.assertContext({ amount: 2000 });
    expect(tm.handlerCalls.length).toBe(handlerCallsBefore);
  });

  it('a superseded quote that later FAILS does not clobber the new flow', async () => {
    const first = deferred<{ historyEntry: string }>();
    let calls = 0;
    const tm = createTestMachine({
      operations: {
        executeMintQuote: async (_mint, amount) => {
          calls += 1;
          if (calls === 1) return first.promise;
          return quoteEntry(`q${calls}`, amount as number);
        },
      },
    });

    await tm.machine.startReceiveLightning({ reset: true });
    const firstPress = tm.machine.enterAmount({ value: 1000, unit: 'sat' }, MINT1, {
      destination: 'mintQuote',
    });
    await tm.machine.enterAmount({ value: 2000, unit: 'sat' }, MINT1, {
      destination: 'mintQuote',
    });
    tm.assertStep('mintQuoteCreated');

    first.reject(new Error('mint exploded'));
    await firstPress;
    // stale failure is discarded — no error step, no error notification
    tm.assertStep('mintQuoteCreated');
    tm.assertContext({ amount: 2000 });
  });

  it('MINT_SELECTED during a pending createMintQuote is NOT dropped', async () => {
    const first = deferred<{ historyEntry: string }>();
    let calls = 0;
    const tm = createTestMachine({
      operations: {
        executeMintQuote: async (mint, amount) => {
          calls += 1;
          if (calls === 1) return first.promise;
          return quoteEntry(`q${calls}`, amount as number, mint as string);
        },
      },
    });

    await tm.machine.startReceiveLightning({ reset: true });
    const firstPress = tm.machine.enterAmount({ value: 1000, unit: 'sat' }, MINT1, {
      destination: 'mintQuote',
    });

    // user backs to the mint selector and picks another mint
    await tm.machine.changeMint(MINT2);
    tm.assertContext({ mintUrl: MINT2 });

    first.resolve(quoteEntry('q1', 1000, MINT1));
    await firstPress;
    tm.assertContext({ mintUrl: MINT2 });
  });

  it('starting a new flow during a pending quote is NOT dropped (no reset needed)', async () => {
    const first = deferred<{ historyEntry: string }>();
    const tm = createTestMachine({
      operations: { executeMintQuote: () => first.promise },
    });

    await tm.machine.startReceiveLightning({ reset: true });
    const firstPress = tm.machine.enterAmount({ value: 1000, unit: 'sat' }, MINT1, {
      destination: 'mintQuote',
    });

    // plain flow start (no reset opts) — e.g. a different entry point
    await tm.machine.startSendEcash();
    tm.assertStep('enterAmount');
    tm.assertContext({ destination: 'sendEcash' });

    first.resolve(quoteEntry('q1', 1000));
    await firstPress;
    tm.assertStep('enterAmount');
    tm.assertContext({ destination: 'sendEcash' });
  });

  it('reset during a pending quote still recovers (existing behavior)', async () => {
    const first = deferred<{ historyEntry: string }>();
    const tm = createTestMachine({
      operations: { executeMintQuote: () => first.promise },
    });
    await tm.machine.startReceiveLightning({ reset: true });
    const firstPress = tm.machine.enterAmount({ value: 1000, unit: 'sat' }, MINT1, {
      destination: 'mintQuote',
    });

    await tm.machine.startReceiveLightning({ reset: true });
    tm.assertStep('enterAmount');

    first.resolve(quoteEntry('q1', 1000));
    await firstPress;
    tm.assertStep('enterAmount');
    expect(
      tm.handlerCalls.filter((h) => h.step === 'mintQuoteCreated')
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Commit protection — events are still dropped while money moves
// ---------------------------------------------------------------------------

describe('back-nav re-entry — commits stay locked', () => {
  it('AMOUNT_ENTERED while an ecash send is executing is dropped', async () => {
    const sendGate = deferred<{ token: string; historyEntry: string }>();
    let sendCalls = 0;
    const hang = async () => {
      sendCalls += 1;
      return sendGate.promise;
    };
    const tm = createTestMachine({
      operations: { executeSend: hang, executeOfflineSend: hang },
    });

    await tm.machine.startSendEcash({ reset: true });
    const commit = tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1, {
      destination: 'sendEcash',
    });

    // token is being cut — a re-driven amount screen must NOT restart the flow
    await tm.machine.enterAmount({ value: 999, unit: 'sat' }, MINT1, {
      destination: 'sendEcash',
    });
    expect(sendCalls).toBe(1);
    tm.assertContext({ amount: 100 });

    sendGate.resolve({
      token: 'cashuAtoken',
      historyEntry: JSON.stringify({
        id: 'send-1',
        type: 'send',
        createdAt: 1,
        mintUrl: MINT1,
        unit: 'sat',
        amount: 100,
        state: 'PENDING',
        token: 'cashuAtoken',
        metadata: {},
      }),
    });
    await commit;
    expect(sendCalls).toBe(1);
    tm.assertContext({ amount: 100 });
  });

  it('CONFIRM_MELT double-press stays a single melt', async () => {
    const meltGate = deferred<Record<string, unknown>>();
    let meltCalls = 0;
    const tm = createTestMachine({
      operations: {
        executeMelt: async () => {
          meltCalls += 1;
          return meltGate.promise as never;
        },
      },
    });

    // drive to the melt preview via a lightning-address style flow
    await tm.machine.startSendEcash({ reset: true, meltTarget: 'user@ln.example' });
    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1, {
      destination: 'meltQuote',
      meltTarget: 'user@ln.example',
    });
    tm.assertStep('navigateToMeltPreview');

    const firstConfirm = tm.machine.confirmMelt();
    await tm.machine.confirmMelt(); // impatient double-tap
    expect(meltCalls).toBe(1);

    meltGate.resolve({
      historyEntry: JSON.stringify({
        id: 'melt-1',
        type: 'melt',
        createdAt: 1,
        mintUrl: MINT1,
        unit: 'sat',
        amount: 100,
        state: 'PAID',
        quoteId: 'melt-1',
        metadata: {},
      }),
    });
    await firstConfirm;
    expect(meltCalls).toBe(1);
  });
});
