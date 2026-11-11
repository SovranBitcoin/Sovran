/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * quote-first-melt.test.ts — Melt quote created BEFORE the Pay tap (BTC-05)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The melt preview used to carry only { mintUrl, meltTarget, unit, amount } —
 * the melt quote (and its fee_reserve) existed only AFTER the user tapped
 * Pay, inside executeMelt. The user always authorized `amount` and was
 * debited `amount + fee_reserve`, a number set by the mint and never shown.
 *
 * Quote-first: when operations.quoteMelt is configured, the machine creates
 * the quote as it routes to navigateToMeltPreview, attaches it to the step
 * data (fee_reserve + mint-quoted amount), and confirmMelt executes against
 * THAT quote — displayed fee == charged fee. Onchain targets keep their
 * at-execution NUT-30 fee picker.
 */

import { describe, it, expect } from 'vitest';
import { deriveMintMethodCapabilityMapFromTrustedMints } from '../../src/mint-capabilities';
import { createTestMachine } from '../_harness';
import { MINT1, MINT2, INPUTS } from '../_harness/fixtures';
import type { MeltQuotePreview } from '../../src/machine/types';

function stubQuote(overrides?: Partial<MeltQuotePreview>): MeltQuotePreview {
  return {
    quoteId: 'quote-1',
    quoteAmount: 200,
    feeReserve: 2,
    unit: 'sat',
    method: 'bolt11',
    mintUrl: MINT1,
    meltTarget: INPUTS.lightningAddress,
    flowAmount: 200,
    ...overrides,
  };
}

describe('quote-first melt preview (BTC-05)', () => {
  it('creates the quote before dispatching the preview handler and attaches it to step data', async () => {
    const tm = createTestMachine({
      operations: { quoteMelt: async () => stubQuote() },
    });
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);

    tm.assertStep('navigateToMeltPreview');

    const quoteCall = tm.operationCalls.find((c) => c.name === 'quoteMelt');
    expect(quoteCall).toBeTruthy();
    expect(quoteCall!.args).toEqual([{ mintUrl: MINT1, meltTarget: INPUTS.lightningAddress, amount: 200, unit: 'sat' }]);

    // The preview handler received the quote — the screen can render
    // amount + fee + total from the moment it appears.
    const previewCall = tm.handlerCalls.find((c) => c.step === 'navigateToMeltPreview');
    expect(previewCall).toBeTruthy();
    expect((previewCall!.data as { meltQuote?: MeltQuotePreview }).meltQuote).toMatchObject({
      quoteId: 'quote-1',
      quoteAmount: 200,
      feeReserve: 2,
    });
  });

  it('confirmMelt executes against the pre-created quote', async () => {
    const tm = createTestMachine({
      operations: { quoteMelt: async () => stubQuote() },
    });
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);
    tm.assertStep('navigateToMeltPreview');

    await tm.machine.confirmMelt();

    const meltCall = tm.operationCalls.find((c) => c.name === 'executeMelt');
    expect(meltCall).toBeTruthy();
    expect(meltCall!.args).toEqual([
      {
        mintUrl: MINT1,
        meltTarget: INPUTS.lightningAddress,
        amount: 200,
        unit: 'sat',
        quoteId: 'quote-1',
      },
    ]);
  });

  it('names the pre-created quote when it says the melt is processing', async () => {
    const tm = createTestMachine({
      operations: { quoteMelt: async () => stubQuote() },
    });
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);

    await tm.machine.confirmMelt();

    const processing = tm.notificationCalls.find((c) => c.key === 'onPaymentProcessing');
    expect(processing!.data).toMatchObject({ variant: 'melt', quoteId: 'quote-1' });
  });

  it('names no quote when it says a melt without one is processing', async () => {
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);

    await tm.machine.confirmMelt();

    const processing = tm.notificationCalls.find((c) => c.key === 'onPaymentProcessing');
    expect(processing!.data).not.toHaveProperty('quoteId');
  });

  it('refreshes an expired preview and asks for approval again before paying', async () => {
    let quotes = 0;
    const tm = createTestMachine({
      operations: { quoteMelt: async () => stubQuote({
        quoteId: `quote-${++quotes}`, feeReserve: quotes === 1 ? 2 : 5,
        expiresAt: quotes === 1 ? 1 : Math.floor(Date.now() / 1000) + 3600,
      }) },
    });
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);
    await tm.machine.confirmMelt();
    tm.assertStep('navigateToMeltPreview');
    expect(tm.operationCalls.filter((c) => c.name === 'executeMelt')).toHaveLength(0);
    expect(quotes).toBe(2);
    const previews = tm.handlerCalls.filter((c) => c.step === 'navigateToMeltPreview');
    expect(previews.at(-1)?.data).toMatchObject({ meltQuote: { quoteId: 'quote-2', feeReserve: 5 } });
    await tm.machine.confirmMelt();
    expect(tm.operationCalls.find((c) => c.name === 'executeMelt')?.args[0]).toMatchObject({ quoteId: 'quote-2' });
  });

  it('does not pay when refreshing an expired preview fails', async () => {
    let quotes = 0;
    const tm = createTestMachine({
      operations: { quoteMelt: async () => {
        if (++quotes > 1) throw new Error('mint unavailable');
        return stubQuote({ expiresAt: 1 });
      } },
    });
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);
    await tm.machine.confirmMelt();
    expect(quotes).toBe(2);
    expect(tm.operationCalls.filter((call) => call.name === 'executeMelt')).toHaveLength(0);
    expect(tm.machine.inspect().isExecuting).toBe(false);
  });

  /**
   * A failed attempt uses its quote up. Pay again must not run under a quote
   * (for a Lightning address, a new invoice too) whose fee was never shown:
   * the first tap after a failure shows the new quote, the next one pays it.
   */
  function failingOnce() {
    const counts = { quotes: 0, attempts: 0 };
    const tm = createTestMachine({
      operations: {
        quoteMelt: async () =>
          stubQuote({ quoteId: `quote-${++counts.quotes}`, feeReserve: counts.quotes === 1 ? 2 : 5 }),
        executeMelt: async () => {
          if (++counts.attempts === 1) throw new Error('Route not found');
          return { historyEntry: JSON.stringify({ id: 'melt-1', type: 'melt', state: 'PAID' }) };
        },
      },
    });
    const melts = () => tm.operationCalls.filter((c) => c.name === 'executeMelt');
    return { tm, counts, melts };
  }

  it('shows a new quote on the first Pay after a failed attempt, and pays it on the next', async () => {
    const { tm, counts, melts } = failingOnce();
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);
    await tm.machine.confirmMelt();
    tm.assertStep('navigateToMeltPreview');
    expect(melts()).toHaveLength(1);

    await tm.machine.confirmMelt();

    expect(melts()).toHaveLength(1);
    expect(counts.quotes).toBe(2);
    tm.assertStep('navigateToMeltPreview');
    const previews = tm.handlerCalls.filter((c) => c.step === 'navigateToMeltPreview');
    expect(previews.at(-1)?.data).toMatchObject({
      phase: { kind: 'preview' },
      meltQuote: { quoteId: 'quote-2', feeReserve: 5 },
    });
    expect(tm.machine.inspect().isExecuting).toBe(false);

    await tm.machine.confirmMelt();

    expect(melts()).toHaveLength(2);
    expect(melts()[1]!.args[0]).toMatchObject({ quoteId: 'quote-2' });
    expect(counts.quotes).toBe(2);
    const processing = tm.notificationCalls.filter((c) => c.key === 'onPaymentProcessing');
    expect(processing.map((c) => (c.data as { quoteId?: string }).quoteId)).toEqual(['quote-1', 'quote-2']);
    expect(tm.notificationCalls.filter((c) => c.key === 'onPaymentConfirmed')).toHaveLength(1);

    // Paid: a further Pay does nothing.
    await tm.machine.confirmMelt();
    expect(melts()).toHaveLength(2);
  });

  it('shows a new quote after a failed attempt when the mint list was opened and closed', async () => {
    const { tm, counts, melts } = failingOnce();
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);
    await tm.machine.confirmMelt();

    await tm.machine.requestMintSelector();
    await tm.machine.confirmMelt();

    expect(melts()).toHaveLength(1);
    expect(counts.quotes).toBe(2);
    await tm.machine.confirmMelt();
    expect(melts()[1]!.args[0]).toMatchObject({ quoteId: 'quote-2' });
  });

  it('never pays the used-up quote when the same mint is picked again after a failed attempt', async () => {
    const { tm, melts } = failingOnce();
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);
    await tm.machine.confirmMelt();

    await tm.machine.changeMint(MINT1);
    await tm.machine.confirmMelt();
    await tm.machine.confirmMelt();

    expect(melts()).toHaveLength(2);
    expect(melts()[1]!.args[0]).toMatchObject({ quoteId: 'quote-2' });
  });

  it('keeps Pay retrying when the new quote cannot be made after a failed attempt', async () => {
    let quotes = 0;
    let attempts = 0;
    const tm = createTestMachine({
      operations: {
        quoteMelt: async () => {
          if (++quotes === 2) throw new Error('mint unavailable');
          return stubQuote({ quoteId: `quote-${quotes}` });
        },
        executeMelt: async () => {
          if (++attempts === 1) throw new Error('Route not found');
          return { historyEntry: JSON.stringify({ id: 'melt-1', type: 'melt', state: 'PAID' }) };
        },
      },
    });
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);
    await tm.machine.confirmMelt();

    await tm.machine.confirmMelt();
    expect(attempts).toBe(1);
    tm.assertStep('navigateToMeltPreview');
    expect(tm.machine.inspect().isExecuting).toBe(false);

    await tm.machine.confirmMelt();
    expect(attempts).toBe(1);
    expect(quotes).toBe(3);

    await tm.machine.confirmMelt();
    expect(attempts).toBe(2);
    const melts = tm.operationCalls.filter((c) => c.name === 'executeMelt');
    expect(melts[1]!.args[0]).toMatchObject({ quoteId: 'quote-3' });
  });

  it('pays again at once after a failed attempt when the preview showed no quote', async () => {
    let attempts = 0;
    const tm = createTestMachine({
      operations: {
        quoteMelt: async () => {
          throw new Error('mint unreachable');
        },
        executeMelt: async () => {
          if (++attempts === 1) throw new Error('Route not found');
          return { historyEntry: JSON.stringify({ id: 'melt-1', type: 'melt', state: 'PAID' }) };
        },
      },
    });
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);
    await tm.machine.confirmMelt();

    await tm.machine.confirmMelt();

    expect(attempts).toBe(2);
  });

  it('navigates without a quote when quote creation fails (Pay falls back to at-execution quoting)', async () => {
    const tm = createTestMachine({
      operations: {
        quoteMelt: async () => {
          throw new Error('mint unreachable');
        },
      },
    });
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);

    tm.assertStep('navigateToMeltPreview');
    const previewCall = tm.handlerCalls.find((c) => c.step === 'navigateToMeltPreview');
    expect(previewCall).toBeTruthy();
    expect((previewCall!.data as { meltQuote?: MeltQuotePreview }).meltQuote).toBeUndefined();

    await tm.machine.confirmMelt();
    const meltCall = tm.operationCalls.find((c) => c.name === 'executeMelt');
    expect(meltCall!.args).toEqual([{ mintUrl: MINT1, meltTarget: INPUTS.lightningAddress, amount: 200, unit: 'sat' }]);
  });

  it('does not pre-create a quote for onchain targets (fee picker stays at execution)', async () => {
    const tm = createTestMachine({
      wallet: {
        mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
          {
            mintUrl: MINT1,
            mintInfo: {
              nuts: {
                '4': { methods: [{ method: 'bolt11', unit: 'sat' }] },
                '5': {
                  methods: [
                    { method: 'bolt11', unit: 'sat' },
                    { method: 'onchain', unit: 'sat' },
                  ],
                },
              },
            },
          },
        ]),
      },
      operations: { quoteMelt: async () => stubQuote() },
    });
    await tm.machine.execute(INPUTS.onchainAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);

    tm.assertStep('navigateToMeltPreview');
    expect(tm.operationCalls.find((c) => c.name === 'quoteMelt')).toBeUndefined();
    const previewCall = tm.handlerCalls.find((c) => c.step === 'navigateToMeltPreview');
    expect((previewCall!.data as { meltQuote?: MeltQuotePreview }).meltQuote).toBeUndefined();
  });

  it('re-quotes when the mint changes from the preview', async () => {
    const tm = createTestMachine({
      operations: { quoteMelt: async ({ mintUrl }) => stubQuote({ mintUrl }) },
    });
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);
    tm.assertStep('navigateToMeltPreview');

    await tm.machine.changeMint(MINT2);

    const quoteCalls = tm.operationCalls.filter((c) => c.name === 'quoteMelt');
    expect(quoteCalls.length).toBe(2);
    expect(quoteCalls[1]!.args[0]).toMatchObject({ mintUrl: MINT2 });

    // Pay executes against the NEW mint's quote.
    await tm.machine.confirmMelt();
    const meltCall = tm.operationCalls.find((c) => c.name === 'executeMelt');
    expect(meltCall!.args[0]).toMatchObject({ mintUrl: MINT2, quoteId: 'quote-1' });
  });
});
