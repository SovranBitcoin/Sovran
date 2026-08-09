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
    expect(quoteCall!.args).toEqual([MINT1, INPUTS.lightningAddress, 200, 'sat']);

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
      MINT1,
      INPUTS.lightningAddress,
      200,
      'sat',
      { quoteId: 'quote-1' },
    ]);
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
    expect(meltCall!.args).toEqual([MINT1, INPUTS.lightningAddress, 200, 'sat']);
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
      operations: { quoteMelt: async (mintUrl) => stubQuote({ mintUrl }) },
    });
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);
    tm.assertStep('navigateToMeltPreview');

    await tm.machine.changeMint(MINT2);

    const quoteCalls = tm.operationCalls.filter((c) => c.name === 'quoteMelt');
    expect(quoteCalls.length).toBe(2);
    expect(quoteCalls[1]!.args[0]).toBe(MINT2);

    // Pay executes against the NEW mint's quote.
    await tm.machine.confirmMelt();
    const meltCall = tm.operationCalls.find((c) => c.name === 'executeMelt');
    expect(meltCall!.args[0]).toBe(MINT2);
    expect(meltCall!.args[4]).toEqual({ quoteId: 'quote-1' });
  });
});
