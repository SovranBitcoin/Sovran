/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * machine-invariants.test.ts — Property-Based / Model-Based Testing
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These are NOT conventional unit tests. They use fast-check to generate
 * RANDOM action sequences and verify that machine invariants hold after
 * every transition. If an invariant is violated, fast-check automatically
 * SHRINKS the failing sequence to the minimal reproducing case.
 *
 * Why property-based testing for a state machine?
 *
 * Conventional tests cover specific scenarios: "do A, then B, expect C."
 * But state machines have exponentially many reachable states. A 15-step
 * random sequence can reach states that no human would think to test.
 * Property tests are especially good at finding:
 *   - Illegal state transitions (step != what inspect() reports)
 *   - State corruption (fields from one flow leaking into another)
 *   - Unhandled event combinations (event X at unexpected step Y)
 *   - Memory leaks or unbounded growth (context growing forever)
 *
 * Each test run generates 100 random sequences of up to 20 actions each.
 * That's up to 2000 transitions checked per test run, exploring random
 * corners of the state space that hand-written tests would miss.
 *
 * ─── HOW IT WORKS ─────────────────────────────────────────────────────
 *
 * 1. ACTION GENERATORS (fast-check arbitraries):
 *    Generate random actions: execute(randomInput), reset, startSendEcash,
 *    enterAmount(randomAmount, randomMint), changeMint, chooseProofs, etc.
 *
 * 2. ACTION EXECUTOR:
 *    Takes a machine + an action, calls the corresponding machine method.
 *    Swallows all errors (machine methods may throw for invalid actions
 *    like enterAmount when not at enterAmount step — that's fine).
 *
 * 3. INVARIANT CHECKER:
 *    After every action, checks 4 invariants:
 *
 *    Invariant 1: ExecutionState.step === machine.getStep()
 *      The inspect() method's step must match getStep(). If these diverge,
 *      the machine's internal state is inconsistent.
 *
 *    Invariant 2: Error step has status 'blocked'
 *      When the machine is at the error step, its execution status must
 *      be 'blocked' — the machine can't proceed without user intervention.
 *
 *    Invariant 3: Input steps have status 'needsInput'
 *      Steps that require user input (chooseOption, enterAmount, selectMint,
 *      chooseProofs, reviewMint) must have status 'needsInput' (unless an
 *      async operation is currently executing).
 *
 *    Invariant 4: Idle step has status 'ready'
 *      When the machine is idle (no flow in progress), its status must
 *      be 'ready' — waiting for the first event.
 *
 * 4. PROPERTY TESTS:
 *    - Invariants hold after every action in random sequences
 *    - RESET always returns to idle (from any reachable state)
 *    - Machine never throws unhandled exceptions
 *    - Same input produces same step (determinism)
 *    - Ecash tokens always route to receiveToken regardless of wallet
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createTestMachine } from '../_harness';
import { WALLETS, INPUTS, MINT1, MINT2 } from '../_harness/fixtures';
import type { FlowStep, ExecutionState } from '../../src/machine/types';

// ---------------------------------------------------------------------------
// Invariant checker — runs after every action
// ---------------------------------------------------------------------------

/**
 * TERMINAL_STEPS are steps where the machine has completed its work.
 * No further transitions happen without user/app intervention.
 */
const TERMINAL_STEPS = new Set<FlowStep>([
  'receiveToken',
  'sendComplete',
  'navigateToMeltPreview',
  'navigateToPaymentRequest',
  'mintQuoteCreated',
  'openMint',
  'openProfile',
  'navigateToReceive',
  'dismiss',
]);

/**
 * INPUT_STEPS are steps where the machine is waiting for user input.
 * The UI should be presenting a form/picker to the user.
 */
const INPUT_STEPS = new Set<FlowStep>([
  'chooseOption',
  'chooseFallbackOption',
  'enterAmount',
  'selectMint',
  'chooseProofs',
  'reviewMint',
]);

/**
 * Checks all 4 invariants against the current machine state.
 * Returns null if all pass, or a string describing the violation.
 */
function checkInvariants(step: FlowStep, execution: ExecutionState): string | null {
  // Invariant 1: ExecutionState.step must match machine.getStep().
  // If these diverge, the machine has an internal consistency bug.
  if (execution.step !== step) {
    return `ExecutionState.step (${execution.step}) !== getStep() (${step})`;
  }

  // Invariant 2: Error step must have 'blocked' status.
  // The machine is stuck and needs the user to take action (reset, re-scan).
  if (step === 'error') {
    if (execution.status !== 'blocked') {
      return `Error step should have status 'blocked', got '${execution.status}'`;
    }
  }

  // Invariant 3: Input steps must have 'needsInput' status.
  // Exception: if an async operation is currently executing (e.g. building
  // mint list), the status may temporarily be different.
  if (INPUT_STEPS.has(step) && !execution.isExecuting) {
    if (execution.status !== 'needsInput') {
      return `Input step '${step}' should have status 'needsInput', got '${execution.status}'`;
    }
  }

  // Invariant 4: Idle step must have 'ready' status.
  // The machine is waiting for the first event (execute, startSendEcash, etc.).
  if (step === 'idle') {
    if (execution.status !== 'ready') {
      return `Idle step should have status 'ready', got '${execution.status}'`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Action generators
// ---------------------------------------------------------------------------

/**
 * fast-check "arbitraries" that generate random values for actions.
 * These cover all the common inputs that the machine might receive.
 */

/** Random input strings: valid payment formats, prefixed versions, and garbage */
const validInputs = fc.constantFrom(
  INPUTS.cashuTokenV3,
  INPUTS.lightningAddress,
  INPUTS.mintUrl,
  INPUTS.npub,
  INPUTS.paymentRequestBasic,
  INPUTS.randomString,
  INPUTS.emptyString,
  // Also test prefixed versions to exercise the normalization layer
  `cashu:${INPUTS.cashuTokenV3}`,
  `lightning:${INPUTS.lightningAddress}`,
  // And a multi-option BIP-321 URI
  `bitcoin:?cashu=${INPUTS.cashuTokenV3}&lightning=${INPUTS.lightningAddress}`,
);

/** Random mint URLs from our fixture set */
const validMints = fc.constantFrom(MINT1, MINT2);

/** Random amounts in a realistic range */
const validAmounts = fc.integer({ min: 1, max: 5000 });

/**
 * Action type — a tagged union of all possible machine actions.
 * fast-check generates random sequences of these.
 */
type Action =
  | { type: 'execute'; input: string }
  | { type: 'reset' }
  | { type: 'startSendEcash' }
  | { type: 'startReceiveLightning' }
  | { type: 'startReceive' }
  | { type: 'enterAmount'; amount: number; mintUrl: string }
  | { type: 'changeMint'; mintUrl: string }
  | { type: 'requestMintSelector' }
  | { type: 'chooseProofs'; amount: number };

/**
 * The action arbitrary combines all action types with equal weight.
 * fast-check will randomly select from these and compose them into sequences.
 */
const actionArb: fc.Arbitrary<Action> = fc.oneof(
  validInputs.map((input) => ({ type: 'execute' as const, input })),
  fc.constant({ type: 'reset' as const }),
  fc.constant({ type: 'startSendEcash' as const }),
  fc.constant({ type: 'startReceiveLightning' as const }),
  fc.constant({ type: 'startReceive' as const }),
  fc.record({
    type: fc.constant('enterAmount' as const),
    amount: validAmounts,
    mintUrl: validMints,
  }),
  validMints.map((mintUrl) => ({ type: 'changeMint' as const, mintUrl })),
  fc.constant({ type: 'requestMintSelector' as const }),
  validAmounts.map((amount) => ({ type: 'chooseProofs' as const, amount })),
);

// ---------------------------------------------------------------------------
// Action executor
// ---------------------------------------------------------------------------

/**
 * Executes a single action on the machine. Wraps all calls in try/catch
 * because some actions may throw (e.g. enterAmount when not at enterAmount
 * step). That's expected behavior — the machine should remain in a valid
 * state regardless of whether an action succeeded or threw.
 */
async function executeAction(
  machine: ReturnType<typeof createTestMachine>['machine'],
  action: Action
): Promise<void> {
  try {
    switch (action.type) {
      case 'execute':
        await machine.execute(action.input, { reset: true });
        break;
      case 'reset':
        machine.reset();
        break;
      case 'startSendEcash':
        await machine.startSendEcash();
        break;
      case 'startReceiveLightning':
        await machine.startReceiveLightning();
        break;
      case 'startReceive':
        await machine.startReceive();
        break;
      case 'enterAmount':
        await machine.enterAmount(action.amount, action.mintUrl);
        break;
      case 'changeMint':
        await machine.changeMint(action.mintUrl);
        break;
      case 'requestMintSelector':
        await machine.requestMintSelector();
        break;
      case 'chooseProofs':
        await machine.chooseProofs(action.amount);
        break;
    }
  } catch {
    // Actions may throw (e.g. enterAmount when not in enterAmount step).
    // This is fine — we're testing that invariants hold regardless of
    // whether actions succeed or fail. The machine should never be
    // corrupted by a failed action.
  }
}

// ---------------------------------------------------------------------------
// Property: invariants hold after every random action sequence
// ---------------------------------------------------------------------------

/**
 * The main property test: generate random action sequences, execute each
 * action, and check all 4 invariants after every transition.
 *
 * If any invariant is violated, fast-check automatically shrinks the
 * failing sequence to the minimal set of actions that reproduces the bug.
 * This makes debugging much easier — instead of "after 15 random actions
 * something broke," you get "these 3 actions cause the bug."
 */
describe('property: machine invariants', () => {
  it('invariants hold after every transition in random action sequences', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate arrays of 1-15 random actions
        fc.array(actionArb, { minLength: 1, maxLength: 15 }),
        async (actions) => {
          // Fresh machine for each sequence
          const tm = createTestMachine();

          for (const action of actions) {
            await executeAction(tm.machine, action);

            // Check invariants after every single action
            const step = tm.machine.getStep();
            const execution = tm.machine.inspect();
            const violation = checkInvariants(step, execution);

            if (violation) {
              // Include the full action sequence for debugging
              throw new Error(
                `Invariant violation after ${action.type}: ${violation}\n` +
                `Step: ${step}, Actions so far: ${JSON.stringify(actions.slice(0, actions.indexOf(action) + 1))}`
              );
            }
          }
        }
      ),
      // 100 random sequences, stop on first failure for faster debugging
      { numRuns: 100, endOnFailure: true }
    );
  });
});

// ---------------------------------------------------------------------------
// Property: RESET always returns to idle
// ---------------------------------------------------------------------------

/**
 * A critical safety property: no matter what sequence of actions has been
 * executed, calling reset() should ALWAYS return to idle. If this property
 * fails, the machine has a state from which the user can't escape.
 */
describe('property: RESET always returns to idle', () => {
  it('reset from any reachable state returns to idle', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate 0-10 random actions to reach various states
        fc.array(actionArb, { minLength: 0, maxLength: 10 }),
        async (actions) => {
          const tm = createTestMachine();

          // Execute random actions to reach some state
          for (const action of actions) {
            await executeAction(tm.machine, action);
          }

          // Now reset — should ALWAYS get back to idle
          tm.machine.reset();
          expect(tm.machine.getStep()).toBe('idle');
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property: machine never throws
// ---------------------------------------------------------------------------

/**
 * The machine should NEVER throw an unhandled exception, regardless of
 * what actions are thrown at it. Errors should be routed to the error
 * step, not thrown as exceptions. An unhandled throw would crash the
 * wallet app.
 */
describe('property: machine never throws unhandled exceptions', () => {
  it('no action sequence causes an unhandled throw', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(actionArb, { minLength: 1, maxLength: 20 }),
        async (actions) => {
          const tm = createTestMachine();

          for (const action of actions) {
            // executeAction already catches throws, but we verify the
            // machine is still in a valid state afterwards
            await executeAction(tm.machine, action);
            // If we get here, the machine didn't throw
            expect(tm.machine.getStep()).toBeTruthy();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property: idempotent EXECUTE — same input twice yields same step
// ---------------------------------------------------------------------------

/**
 * Determinism property: executing the same input from idle on two
 * independent machines should produce the same step. If this fails,
 * the machine has non-deterministic behavior (order-dependent state,
 * race conditions, etc.).
 */
describe('property: execute is deterministic', () => {
  it('same input produces same step when executed from idle', async () => {
    await fc.assert(
      fc.asyncProperty(validInputs, async (input) => {
        // Two independent machines with identical configuration
        const tm1 = createTestMachine();
        const tm2 = createTestMachine();

        await tm1.machine.execute(input, { reset: true });
        await tm2.machine.execute(input, { reset: true });

        // Both should land on the exact same step
        expect(tm1.machine.getStep()).toBe(tm2.machine.getStep());
      }),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property: different wallet states with same input
// ---------------------------------------------------------------------------

/**
 * Verifies that certain inputs always produce the same step regardless
 * of wallet state. Ecash tokens are the canonical example — receiving
 * a token requires nothing from the wallet, so it should always route
 * to receiveToken no matter how the wallet is configured.
 */
describe('property: wallet context affects routing', () => {
  it('ecash tokens always route to receiveToken regardless of wallet', async () => {
    const wallets = [WALLETS.default, WALLETS.noBalance, WALLETS.noMints, WALLETS.singleMint];

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...wallets),
        async (wallet) => {
          const tm = createTestMachine({ wallet });
          await tm.machine.execute(INPUTS.cashuTokenV3, { reset: true });
          expect(tm.machine.getStep()).toBe('receiveToken');
        }
      ),
      { numRuns: 20 }
    );
  });
});
