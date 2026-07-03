/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * interruptions.test.ts — Flow Interruption & Recovery
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Real users don't follow happy paths. They:
 *   - Tap "Cancel" mid-flow (reset)
 *   - Scan a new QR code while in a different flow (re-execute)
 *   - Hit an error and try again (error recovery)
 *   - Switch between "Send" and "Receive" without finishing (flow switching)
 *
 * These tests verify the machine handles all of these interruptions
 * gracefully. The key property: the machine should NEVER get stuck.
 * From any state, the user should always be able to:
 *   1. Reset to idle
 *   2. Execute a new input (overriding the current flow)
 *   3. Start a new flow (send/receive)
 *
 * This is possible because RESET and EXECUTE are GLOBAL events — they
 * work from any step. The machine wrapper also supports startSendEcash
 * and startReceiveLightning from any step (they internally reset first).
 *
 * Testing strategy:
 *   - Manual tests: explicit step-by-step assertions for clarity
 *   - Table-driven scenarios: declarative format for complex sequences
 */

import { describe, it, expect } from 'vitest';
import { createTestMachine, runScenario } from '../_harness';
import { MINT1, INPUTS } from '../_harness/fixtures';
import type { FlowScenario } from '../_harness/types';

// ---------------------------------------------------------------------------
// Reset mid-flow
// ---------------------------------------------------------------------------

/**
 * Resetting mid-flow is the cleanest way to cancel an operation. It
 * returns to idle and clears ALL accumulated context. After reset,
 * the machine is in a pristine state, ready for a new flow.
 */
describe('interruptions — reset', () => {
  it('reset from enterAmount returns to idle', async () => {
    const tm = createTestMachine();
    // Start a send flow → enterAmount
    await tm.machine.startSendEcash();
    tm.assertStep('enterAmount');

    // User taps Cancel → reset to idle
    tm.machine.reset();
    tm.assertStep('idle');
  });

  it('reset clears all accumulated context', async () => {
    const tm = createTestMachine();
    // Build up context through a lightning address flow
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    await tm.machine.enterAmount({ value: 100, unit: 'sat' }, MINT1);

    // Now reset — every flow field should be cleared
    tm.machine.reset();
    const ctx = tm.machine.getContext();
    expect(ctx.amount).toBeUndefined();
    expect(ctx.mintUrl).toBeUndefined();
    expect(ctx.meltTarget).toBeUndefined();
    expect(ctx.parsed).toBeUndefined();
  });

  it('can start a new flow after reset', async () => {
    const tm = createTestMachine();
    // Start and interrupt one flow
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    tm.machine.reset();

    // Start a completely different flow — should work fine
    await tm.machine.execute(INPUTS.cashuTokenV3, { reset: true });
    tm.assertStep('receiveToken');
  });
});

// ---------------------------------------------------------------------------
// Re-scan during flow (new execute overrides current)
// ---------------------------------------------------------------------------

/**
 * Users often scan a new QR code while already in a flow. For example:
 *   1. Scan lightning address → machine is at enterAmount
 *   2. Scan cashu token → should override and go to receiveToken
 *
 * This works because execute() with { reset: true } clears the current
 * state before processing the new input.
 */
describe('interruptions — re-execute', () => {
  it('execute during enterAmount overrides current flow', async () => {
    const tm = createTestMachine();
    // Start lightning flow → enterAmount
    await tm.machine.execute(INPUTS.lightningAddress, { reset: true });
    tm.assertStep('enterAmount');

    // Scan a cashu token → should override the lightning flow entirely
    await tm.machine.execute(INPUTS.cashuTokenV3, { reset: true });
    tm.assertStep('receiveToken');
  });

  it('execute during chooseOption overrides current flow', async () => {
    // Multi-option BIP-321 → chooseOption
    const input = `bitcoin:?cashu=${INPUTS.cashuTokenV3}&lightning=${INPUTS.lightningAddress}`;
    const tm = createTestMachine();
    await tm.machine.execute(input, { reset: true });
    tm.assertStep('chooseOption');

    // Before choosing an option, scan a mint URL → overrides
    await tm.machine.execute(INPUTS.mintUrl, { reset: true });
    tm.assertStep('openMint');
  });
});

// ---------------------------------------------------------------------------
// Error recovery
// ---------------------------------------------------------------------------

/**
 * After an error (unrecognized input, failed operation, etc.), the user
 * should be able to recover by:
 *   - Scanning/pasting new valid input (execute)
 *   - Resetting to idle (reset)
 *   - Starting a new flow (startSendEcash, etc.)
 *
 * The error step should never be a dead end.
 */
describe('interruptions — error recovery', () => {
  it('can execute after error step', async () => {
    const tm = createTestMachine();
    // Invalid input → error
    await tm.machine.execute(INPUTS.randomString, { reset: true });
    tm.assertStep('error');

    // Scan valid token → should recover from error
    await tm.machine.execute(INPUTS.cashuTokenV3, { reset: true });
    tm.assertStep('receiveToken');
  });

  it('can reset from error step', async () => {
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.randomString, { reset: true });
    tm.assertStep('error');

    // Reset should always work, even from error
    tm.machine.reset();
    tm.assertStep('idle');
  });

  it('can start new flow after error', async () => {
    const tm = createTestMachine();
    await tm.machine.execute(INPUTS.randomString, { reset: true });
    // Reset first, then start a new flow
    tm.machine.reset();

    await tm.machine.startSendEcash();
    tm.assertStep('enterAmount');
  });
});

// ---------------------------------------------------------------------------
// Flow switching (sendEcash → receiveLightning)
// ---------------------------------------------------------------------------

/**
 * Users might tap "Send", then immediately change their mind and tap
 * "Receive". The second action should completely replace the first flow.
 *
 * This is detected by checking the `destination` in context:
 *   - 'sendEcash' → user is sending
 *   - 'mintQuote' → user is receiving via Lightning
 *
 * After switching, the destination should match the new flow.
 */
describe('interruptions — flow switching', () => {
  it('startReceiveLightning overrides sendEcash flow', async () => {
    const tm = createTestMachine();
    // Start send flow
    await tm.machine.startSendEcash();
    tm.assertStep('enterAmount');
    tm.assertContext({ destination: 'sendEcash' });

    // Switch to receive flow — should override
    await tm.machine.startReceiveLightning();
    tm.assertStep('enterAmount');
    // Destination should now be mintQuote (receive), not sendEcash
    tm.assertContext({ destination: 'mintQuote' });
  });

  it('startSendEcash overrides receiveLightning flow', async () => {
    const tm = createTestMachine();
    // Start receive flow
    await tm.machine.startReceiveLightning();
    tm.assertContext({ destination: 'mintQuote' });

    // Switch to send flow — should override
    await tm.machine.startSendEcash();
    // Destination should now be sendEcash
    tm.assertContext({ destination: 'sendEcash' });
  });
});

// ---------------------------------------------------------------------------
// Scenario format
// ---------------------------------------------------------------------------

/**
 * Complex interruption sequences expressed as declarative scenarios.
 * These test multi-step sequences with intermediate assertions (waypoints).
 */

const RESET_MID_FLOW: FlowScenario = {
  name: 'reset mid-flow: send → enterAmount → reset → receive → enterAmount',
  steps: [
    // Step 0: Start send flow → enterAmount
    { type: 'startSendEcash' },
    // Step 1: Reset → idle (cancel the send)
    { type: 'reset' },
    // Step 2: Start receive flow → enterAmount (new flow)
    { type: 'startReceiveLightning' },
  ],
  waypoints: [
    // After step 0: should be at enterAmount (send flow)
    { afterStep: 0, step: 'enterAmount' },
    // After step 1: should be at idle (clean slate)
    { afterStep: 1, step: 'idle' },
  ],
  expect: {
    // After step 2: should be at enterAmount (receive flow)
    step: 'enterAmount',
    context: { destination: 'mintQuote' },
  },
};

const RE_EXECUTE_OVERRIDE: FlowScenario = {
  name: 're-execute override: lightning → cashu token overrides',
  steps: [
    // Step 0: Execute lightning address → enterAmount
    { type: 'execute', input: INPUTS.lightningAddress },
    // Step 1: Execute cashu token → overrides entire flow → receiveToken
    { type: 'execute', input: INPUTS.cashuTokenV3 },
  ],
  waypoints: [
    // After step 0: should be at enterAmount (lightning flow)
    { afterStep: 0, step: 'enterAmount' },
  ],
  expect: {
    // After step 1: cashu token should have completely replaced the lightning flow
    step: 'receiveToken',
  },
};

describe('interruptions — table-driven scenarios', () => {
  it.each([
    RESET_MID_FLOW,
    RE_EXECUTE_OVERRIDE,
  ])('$name', async (scenario) => {
    await runScenario(scenario);
  });
});
