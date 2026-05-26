/**
 * ═══════════════════════════════════════════════════════════════════════════
 * createTestMachine.ts — Test Harness Builder
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is the core of the test infrastructure. It creates a fully functional
 * PaymentMachine instance configured for testing, with three recording
 * systems that capture every interaction:
 *
 *   1. RECORDING HANDLERS — capture every step handler call
 *      When the machine transitions to a step (e.g. receiveToken), it
 *      calls the registered handler. In tests, handlers are no-ops that
 *      record the call for later assertion.
 *
 *   2. RECORDING OPERATIONS — capture every operation call
 *      Operations like executeSend, executeMintQuote, etc. are wrapped
 *      to record their invocations, arguments, and results.
 *
 *   3. RECORDING NOTIFICATIONS — capture every notification
 *      Notifications (UI feedback) are captured via a Proxy that records
 *      any method call on the notification handler map.
 *
 * The test machine uses REAL detectors (defaultDetectors) — the same
 * @cashu/cashu-ts, bolt11-decode, and nostr-tools decoders used in
 * production. This means test fixtures must be real, valid encoded strings.
 *
 * USAGE:
 *   const tm = createTestMachine({ wallet: WALLETS.noBalance });
 *   await tm.machine.execute(INPUTS.cashuTokenV3, { reset: true });
 *   tm.assertStep('receiveToken');
 *   tm.assertContext({ amount: 100 });
 *   expect(tm.handlerCalls).toHaveLength(1);
 *
 * ALSO EXPORTS: runScenario() — a declarative test runner that executes
 * FlowAction sequences, checks intermediate waypoints, and asserts the
 * final state.
 */

import { expect } from 'vitest';

import { createPaymentMachine } from '../../src/machine/createMachine';
import { defaultDetectors } from '../../src/detectors';
import type {
  FlowContext,
  FlowStep,
  ExecutionState,
  PaymentMachine,
  StepHandlerMap,
  NotificationHandlerMap,
} from '../../src/machine/types';
import type { Detectors, WalletContext } from '../../src/types';

import { WALLETS } from './fixtures';
import { createMockOperations, resetTxCounter } from './mockOperations';
import type {
  TestMachine,
  TestMachineConfig,
  TestMachineSnapshot,
  HandlerCall,
  NotificationCall,
  OperationCall,
  FlowScenario,
  FlowAction,
} from './types';

// ---------------------------------------------------------------------------
// Default wallet context
// ---------------------------------------------------------------------------

/**
 * Merges user-provided wallet overrides with WALLETS.default.
 * This lets tests specify only the fields they care about:
 *   createTestMachine({ wallet: { preferredMintUrl: undefined } })
 * The rest of the wallet state comes from WALLETS.default.
 */
function buildWalletContext(overrides?: Partial<WalletContext>): WalletContext {
  return { ...WALLETS.default, ...overrides };
}

// ---------------------------------------------------------------------------
// Recording handlers — capture every handler call
// ---------------------------------------------------------------------------

/**
 * Every possible FlowStep that has a handler. When the machine transitions
 * to one of these steps, it calls the corresponding handler function.
 * In tests, each handler is a recording no-op.
 */
const ALL_STEPS: FlowStep[] = [
  'chooseOption',
  'chooseFallbackOption',
  'enterAmount',
  'selectMint',
  'chooseProofs',
  'receiveToken',
  'confirmSend',
  'sendComplete',
  'navigateToMeltPreview',
  'navigateToPaymentRequest',
  'createMintQuote',
  'mintQuoteCreated',
  'openMint',
  'openProfile',
  'navigateToReceive',
  'reviewMint',
  'dismiss',
  'error',
];

/**
 * Creates a StepHandlerMap where every step handler is a recording function.
 * Each call is pushed to the `calls` array with { step, data }.
 *
 * Example: when the machine reaches 'receiveToken', the handler records:
 *   { step: 'receiveToken', data: { token: 'cashuA...', amount: 100, ... } }
 */
function createRecordingHandlers(calls: HandlerCall[]): StepHandlerMap {
  const handlers: StepHandlerMap = {};
  for (const step of ALL_STEPS) {
    (handlers as Record<string, Function>)[step] = (data: unknown) => {
      calls.push({ step, data });
    };
  }
  return handlers;
}

// ---------------------------------------------------------------------------
// Recording notifications
// ---------------------------------------------------------------------------

/**
 * Creates a Proxy that records all notification calls. Unlike handlers
 * (which have a fixed set of step names), notifications can have any key.
 * The Proxy intercepts all property access and returns a recording function.
 *
 * Example: machine.notify.sendSuccess({ ... }) records:
 *   { key: 'sendSuccess', data: { ... } }
 */
function createRecordingNotifications(calls: NotificationCall[]): NotificationHandlerMap {
  return new Proxy({} as NotificationHandlerMap, {
    get(_target, key: string) {
      return (...args: unknown[]) => {
        calls.push({ key, data: args.length === 1 ? args[0] : args });
      };
    },
  });
}

// ---------------------------------------------------------------------------
// createTestMachine
// ---------------------------------------------------------------------------

/**
 * Creates a fully configured test machine with recording handlers,
 * mock operations, and recording notifications.
 *
 * @param config - Optional overrides for wallet state, operations,
 *   detectors, unit, offline mode, locale, and NFC adapter.
 * @returns TestMachine with assertion helpers and recording arrays.
 */
export function createTestMachine(config?: TestMachineConfig): TestMachine {
  // Reset the deterministic transaction counter so each test starts fresh
  resetTxCounter();

  const walletCtx = buildWalletContext(config?.wallet);
  const handlerCalls: HandlerCall[] = [];
  const notificationCalls: NotificationCall[] = [];
  const operationCalls: OperationCall[] = [];

  // Use real detectors by default, with optional overrides for specific tests
  // (e.g. custom getPaymentRequestInfo for annotation testing)
  const detectors: Detectors = config?.detectors
    ? { ...defaultDetectors, ...config.detectors }
    : defaultDetectors;

  // Create the real PaymentMachine with our recording infrastructure
  const machine = createPaymentMachine({
    handlers: createRecordingHandlers(handlerCalls),
    detectors,
    // getContext returns the wallet state — called on every transition
    getContext: () => walletCtx,
    getUnit: () => config?.unit ?? 'sat',
    getOffline: () => config?.offline ?? false,
    getLocale: () => config?.locale ?? 'en',
    // Mock operations with recording — see mockOperations.ts
    operations: createMockOperations(config?.operations, operationCalls),
    notifications: createRecordingNotifications(notificationCalls),
    nfcAdapter: config?.nfcAdapter,
    // Scan sources — mostly stubs for testing (no real clipboard/camera)
    scanSources: {
      clipboard: async () => ({ empty: true as const }),
      gallery: async () => ({ canceled: true as const }),
      nfc: config?.nfcAdapter
        ? async () => {
            try {
              const data = await config.nfcAdapter!.readPaymentRequest();
              return { data };
            } catch (err) {
              return { error: err instanceof Error ? err : new Error(String(err)) };
            }
          }
        : undefined,
    },
  });

  return {
    machine,
    handlerCalls,
    notificationCalls,
    operationCalls,

    /**
     * Assert the machine is at the expected step. Fails with a clear
     * message if the step doesn't match.
     */
    assertStep(expected: FlowStep) {
      expect(machine.getStep()).toBe(expected);
    },

    /**
     * Assert the machine's context contains the expected fields.
     * Uses toMatchObject for partial matching — you only need to specify
     * the fields you care about.
     */
    assertContext(matcher: Partial<FlowContext>) {
      expect(machine.getContext()).toMatchObject(matcher);
    },

    /**
     * Assert the machine's execution state matches expected fields.
     * Useful for checking status, isExecuting, etc.
     */
    assertExecution(matcher: Partial<ExecutionState>) {
      expect(machine.inspect()).toMatchObject(matcher);
    },

    /**
     * Capture the full machine state for snapshot comparisons.
     */
    snapshot(): TestMachineSnapshot {
      return {
        step: machine.getStep(),
        context: machine.getContext(),
        execution: machine.inspect(),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Scenario runner
// ---------------------------------------------------------------------------

/**
 * Executes a single FlowAction on the machine. This is the bridge between
 * the declarative FlowAction type and the imperative machine API.
 *
 * For chooseOption actions, it looks up the matching option from the
 * machine's current context — this is needed because the option object
 * must be the exact reference from the parsed options array.
 */
async function executeAction(machine: PaymentMachine, action: FlowAction): Promise<void> {
  switch (action.type) {
    case 'execute':
      await machine.execute(action.input, { reset: true });
      break;
    case 'scan':
      await machine.scan?.(action.data, { source: action.source });
      break;
    case 'enterAmount':
      await machine.enterAmount(action.amount, action.mintUrl, {
        destination: action.destination,
        offline: action.offline,
      });
      break;
    case 'chooseOption': {
      // Look up the actual option object from the machine's context.
      // We can't pass a bare { kind, value } because the machine may
      // need the exact reference for identity comparison.
      const ctx = machine.getContext();
      const options = ctx.parsed?.options ?? ctx.originalOptions?.map((ao) => ao.option) ?? [];
      const match = options.find(
        (o) =>
          o.kind === action.optionKind &&
          (action.optionValue === undefined || o.value === action.optionValue)
      );
      if (!match) {
        throw new Error(
          `No option with kind '${action.optionKind}' found. Available: ${options.map((o) => o.kind).join(', ')}`
        );
      }
      await machine.chooseOption(match);
      break;
    }
    case 'changeMint':
      await machine.changeMint(action.mintUrl, {
        persist: action.persist,
        scope: action.scope,
      });
      break;
    case 'chooseProofs':
      await machine.chooseProofs(action.amount);
      break;
    case 'requestMintSelector':
      await machine.requestMintSelector({ scope: action.scope });
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
    case 'confirmMelt':
      await machine.confirmMelt();
      break;
    case 'confirmPaymentRequest':
      await machine.confirmPaymentRequest();
      break;
    case 'reviewMint':
      await machine.reviewMint(action.mintUrl, action.token);
      break;
    case 'mintTrusted':
      await machine.mintTrusted();
      break;
    case 'reset':
      machine.reset();
      break;
  }
}

/**
 * Runs a complete FlowScenario:
 *   1. Creates a test machine with the scenario's wallet/offline config
 *   2. Executes each step in sequence
 *   3. Checks intermediate waypoints (assertions after specific steps)
 *   4. Asserts the final expected state (step, context, data, execution)
 *
 * @param scenario - The declarative scenario definition
 * @param configOverrides - Additional test machine configuration
 * @returns The TestMachine for further assertions if needed
 */
export async function runScenario(
  scenario: FlowScenario,
  configOverrides?: Partial<TestMachineConfig>
): Promise<TestMachine> {
  const tm = createTestMachine({
    wallet: scenario.wallet,
    offline: scenario.offline,
    ...configOverrides,
  });

  for (let i = 0; i < scenario.steps.length; i++) {
    await executeAction(tm.machine, scenario.steps[i]);

    // Check waypoint assertions (intermediate state checks)
    const waypoint = scenario.waypoints?.find((w) => w.afterStep === i);
    if (waypoint) {
      expect(tm.machine.getStep()).toBe(waypoint.step);
      if (waypoint.context) {
        expect(tm.machine.getContext()).toMatchObject(waypoint.context);
      }
    }
  }

  // Assert final expected state
  tm.assertStep(scenario.expect.step);
  if (scenario.expect.context) tm.assertContext(scenario.expect.context);
  if (scenario.expect.data) {
    // Check data passed to the handler for the final step
    const lastHandler = tm.handlerCalls[tm.handlerCalls.length - 1];
    if (lastHandler) {
      expect(lastHandler.data).toMatchObject(scenario.expect.data);
    }
  }
  if (scenario.expect.execution) tm.assertExecution(scenario.expect.execution);

  return tm;
}
