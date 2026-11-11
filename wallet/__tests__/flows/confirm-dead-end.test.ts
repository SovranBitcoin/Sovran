/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * confirm-dead-end.test.ts — CONFIRM_MELT on a mint-less selector (BTC-09)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Opening the mint pill from a preview moves the machine to selectMint; if
 * the selector is dismissed with no mint ever chosen, the machine stays on
 * selectMint while the UI still shows the terminal screen. A Pay tap
 * (CONFIRM_MELT / CONFIRM_PAYMENT_REQUEST) used to fall through every guard
 * and be dropped silently — an inert button, no error, no recovery. The
 * machine must surface the missing mint and re-open the selector instead.
 */

import { describe, it, expect } from 'vitest';
import { createTestMachine } from '../_harness';
import { MINT1, INPUTS } from '../_harness/fixtures';

describe('CONFIRM_MELT on a mint-less selectMint step (BTC-09)', () => {
  it('notifies and re-dispatches the selector instead of dropping the confirm', async () => {
    const tm = createTestMachine();
    // Lightning address flow: meltTarget set, no amount/mint yet.
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    tm.assertStep('enterAmount');
    // Open the mint selector — the flow has a destination but no chosen mint.
    await tm.machine.requestMintSelector();
    tm.assertStep('selectMint');

    const selectMintCallsBefore = tm.handlerCalls.filter(
      (c) => c.step === 'selectMint'
    ).length;

    // The user taps Pay on the still-visible preview: the confirm must not
    // vanish silently.
    await tm.machine.confirmMelt();

    const missingMint = tm.notificationCalls.find(
      (c) => c.key === 'onMissingMintForAmount'
    );
    expect(missingMint).toBeTruthy();

    // The selector handler re-runs so the UI re-opens mint selection.
    const selectMintCallsAfter = tm.handlerCalls.filter(
      (c) => c.step === 'selectMint'
    ).length;
    expect(selectMintCallsAfter).toBe(selectMintCallsBefore + 1);

    // The machine must not lock up: a subsequent mint selection still works.
    await tm.machine.changeMint(MINT1);
    tm.assertStep('enterAmount');
  });

  it('still restores and confirms when mint + amount are in context', async () => {
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);
    tm.assertStep('navigateToMeltPreview');

    // Open + dismiss the selector (mint and amount survive in context).
    await tm.machine.requestMintSelector();
    tm.assertStep('selectMint');

    await tm.machine.confirmMelt();

    // Restore path: the melt executed — no missing-mint notification.
    const meltCall = tm.operationCalls.find((c) => c.name === 'executeMelt');
    expect(meltCall).toBeTruthy();
    expect(
      tm.notificationCalls.find((c) => c.key === 'onMissingMintForAmount')
    ).toBeUndefined();
  });

  // The preview's mint pill opens the list again while it is already open:
  // the list stays opened over the preview, so Pay still restores it.
  it('restores and pays a melt preview after the list was opened and dismissed twice', async () => {
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1);
    tm.assertStep('navigateToMeltPreview');

    await tm.machine.requestMintSelector();
    await tm.machine.requestMintSelector();
    tm.assertStep('selectMint');

    await tm.machine.confirmMelt();

    expect(tm.operationCalls.filter((c) => c.name === 'executeMelt')).toHaveLength(1);
    expect(
      tm.notificationCalls.find((c) => c.key === 'onMissingMintForAmount')
    ).toBeUndefined();
  });

  it('restores and pays a payment request preview after the list was opened and dismissed twice', async () => {
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.paymentRequestBasic, { reset: true });
    tm.assertStep('navigateToPaymentRequest');

    await tm.machine.requestMintSelector();
    await tm.machine.requestMintSelector();
    tm.assertStep('selectMint');

    expect((await tm.machine.confirmPaymentRequest()).kind).toBe('delivered');

    expect(
      tm.operationCalls.filter((c) => c.name === 'executePaymentRequest')
    ).toHaveLength(1);
    expect(
      tm.notificationCalls.find((c) => c.key === 'onMissingMintForAmount')
    ).toBeUndefined();
  });
});

describe('Pay on a still-mounted preview after the machine moved to error', () => {
  const RECIPIENT = 'cd'.repeat(32);

  // QUIRK: BTC-09 says a confirm tap must never be dropped silently, but here
  // it is. A Lightning-address melt failed, the person dismissed the
  // npub.cash fallback (step `error`, MELT_FAILED), then tapped Pay on the
  // preview that is still on screen. The machine is not on the preview, so
  // the tap runs nothing and shows nothing; the error keeps its code and
  // message. Whether that tap should retry the payment, reopen the preview or
  // show the error again is a product choice, not settled here.
  it('runs nothing and keeps the error as it was', async () => {
    let attempts = 0;
    const tm = createTestMachine({
      operations: {
        executeMelt: async () => {
          attempts += 1;
          throw new Error('LNURL invoice fetch failed');
        },
        npcAddressForPubkey: () => 'npub1recipient@npubx.cash',
      },
    });
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 200, unit: 'sat' }, MINT1, {
      recipientPubkey: RECIPIENT,
    });
    await tm.machine.confirmMelt();
    tm.assertStep('chooseSendFallback');
    await tm.machine.chooseSendFallback(null);
    tm.assertStep('error');
    const handlerCalls = tm.handlerCalls.length;

    await tm.machine.confirmMelt();

    expect(attempts).toBe(1);
    tm.assertStep('error');
    expect(tm.handlerCalls).toHaveLength(handlerCalls);
    tm.assertError({
      code: 'MELT_FAILED',
      message: 'LNURL invoice fetch failed',
    });
  });
});
