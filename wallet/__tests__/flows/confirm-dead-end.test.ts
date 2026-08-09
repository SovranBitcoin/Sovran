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
});
