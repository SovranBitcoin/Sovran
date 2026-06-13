/**
 * ═══════════════════════════════════════════════════════════════════════════
 * types.ts — Test Infrastructure Types
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Type definitions for the test harness, scenario runner, and recording
 * systems. These types are the "language" of the test suite — they define
 * how tests configure machines, describe flows, and record interactions.
 *
 * Three categories:
 *
 *   1. TEST MACHINE TYPES — Configuration and output of createTestMachine()
 *   2. RECORDING TYPES — Captured handler/operation/notification calls
 *   3. SCENARIO TYPES — Declarative flow definitions for table-driven tests
 */

import type {
  Destination,
  FlowContext,
  FlowStep,
  ExecutionState,
  PaymentMachine,
  MachineOperations,
  NfcIOAdapter,
} from '../../src/machine/types';
import type { Detectors, PaymentOptionKind, WalletContext } from '../../src/types';

// ---------------------------------------------------------------------------
// Test machine — wraps PaymentMachine with recording + assertion helpers
// ---------------------------------------------------------------------------

/**
 * Configuration for createTestMachine(). All fields are optional —
 * defaults are provided by the harness.
 *
 * Common patterns:
 *   createTestMachine() — default wallet, default everything
 *   createTestMachine({ wallet: WALLETS.noBalance }) — custom wallet
 *   createTestMachine({ offline: true }) — offline mode
 *   createTestMachine({ operations: { executeSend: async () => { throw new Error(); } } }) — operation override
 */
export interface TestMachineConfig {
  /** Partial wallet state. Merged with WALLETS.default. */
  wallet?: Partial<WalletContext>;
  /** Override specific operations (e.g. to simulate failures). */
  operations?: Partial<MachineOperations>;
  /** Override specific detectors (e.g. custom getPaymentRequestInfo). */
  detectors?: Partial<Detectors>;
  /** Currency unit. Defaults to 'sat'. */
  unit?: string;
  /** Whether the wallet is in offline mode. Defaults to false. */
  offline?: boolean;
  /** Locale for localization. Defaults to 'en'. */
  locale?: string;
  /** NFC adapter for NFC-related tests. */
  nfcAdapter?: NfcIOAdapter;
  /** Enables the optional ecash token memo step. Defaults to false. */
  enableEcashSendMemo?: boolean;
}

/**
 * A single recorded handler call. Handlers are called when the machine
 * transitions to a step. Tests use this to verify:
 *   - The right handler was called
 *   - The handler received the expected data
 */
export interface HandlerCall {
  step: FlowStep;
  data: unknown;
}

/**
 * A single recorded notification call. Notifications are fire-and-forget
 * UI feedback (e.g. "send successful", "copy to clipboard").
 */
export interface NotificationCall {
  key: string;
  data: unknown;
}

/**
 * A single recorded operation call. Operations are async side effects
 * (e.g. executeSend, trustMint). The recording includes:
 *   - name: which operation was called
 *   - args: what arguments it received
 *   - result: what it returned (if successful)
 *   - error: what it threw (if failed)
 */
export interface OperationCall {
  name: string;
  args: unknown[];
  result?: unknown;
  error?: unknown;
}

/**
 * A snapshot of the machine's full state at a point in time.
 * Used for debugging and snapshot testing.
 */
export interface TestMachineSnapshot {
  step: FlowStep;
  context: FlowContext;
  execution: ExecutionState;
}

/**
 * The object returned by createTestMachine(). Provides:
 *   - machine: the real PaymentMachine instance
 *   - Assertion helpers: assertStep, assertContext, assertExecution
 *   - Recording arrays: handlerCalls, notificationCalls, operationCalls
 *   - snapshot(): capture full state
 */
export interface TestMachine {
  machine: PaymentMachine;

  /** Assert the machine is at a specific step. */
  assertStep(expected: FlowStep): void;
  /** Assert context contains expected fields (partial match). */
  assertContext(matcher: Partial<FlowContext>): void;
  /** Assert execution state matches expected fields. */
  assertExecution(matcher: Partial<ExecutionState>): void;

  /** All step handler calls, in order. */
  handlerCalls: HandlerCall[];
  /** All notification calls, in order. */
  notificationCalls: NotificationCall[];
  /** All operation calls, in order. */
  operationCalls: OperationCall[];

  /** Capture a snapshot of the current machine state. */
  snapshot(): TestMachineSnapshot;
}

// ---------------------------------------------------------------------------
// Flow scenarios — declarative test definitions
// ---------------------------------------------------------------------------

/**
 * FlowAction represents a single user action in a flow scenario.
 * Each action maps to a PaymentMachine method call.
 *
 * The tagged union (discriminated by `type`) covers every machine method
 * that tests need to call. Each variant carries the parameters needed
 * for that specific method.
 */
export type FlowAction =
  /** Parse and route a raw input string (QR scan, clipboard paste). */
  | { type: 'execute'; input: string }
  /** Scan from a specific source (NFC, camera, etc.). */
  | { type: 'scan'; data?: string; source?: string }
  /** User enters an amount. Can optionally specify destination and offline mode. */
  | { type: 'enterAmount'; amount: number; mintUrl: string; destination?: Destination; offline?: boolean }
  /** User picks a payment option from the multi-option screen. */
  | { type: 'chooseOption'; optionKind: PaymentOptionKind; optionValue?: string }
  /** User selects a different mint. */
  | { type: 'changeMint'; mintUrl: string; persist?: boolean; scope?: 'npc' | 'selected' }
  /** User selects a proof composition amount. */
  | { type: 'chooseProofs'; amount: number }
  /** User submits or skips the optional ecash token memo. */
  | { type: 'submitSendMemo'; memo?: string }
  /** User taps the mint selector button. */
  | { type: 'requestMintSelector'; scope?: 'npc' | 'selected' }
  /** User taps the "Send" button. */
  | { type: 'startSendEcash' }
  /** User taps "Receive" → "Lightning". */
  | { type: 'startReceiveLightning' }
  /** User taps "Receive" (hub screen). */
  | { type: 'startReceive' }
  /** User confirms a Lightning melt operation. */
  | { type: 'confirmMelt' }
  /** User confirms a payment request operation. */
  | { type: 'confirmPaymentRequest' }
  /** App initiates mint trust review (untrusted mint detected). */
  | { type: 'reviewMint'; mintUrl: string; token: string }
  /** User trusts the mint after reviewing. */
  | { type: 'mintTrusted' }
  /** User taps Cancel / Back — reset to idle. */
  | { type: 'reset' };

/**
 * A waypoint is an intermediate assertion checked during a scenario.
 * After step N completes, the machine should be at the specified step
 * with optional context fields matching.
 *
 * Waypoints verify that the flow passes through expected intermediate
 * states — not just the final state.
 */
export interface FlowWaypoint {
  /** Check after this step index (0-based) completes. */
  afterStep: number;
  /** Expected step at this point in the flow. */
  step: FlowStep;
  /** Optional context assertions at this point. */
  context?: Partial<FlowContext>;
}

/**
 * The expected final state after all scenario steps complete.
 */
export interface FlowExpectation {
  /** The step the machine should be on after all actions. */
  step: FlowStep;
  /** Partial context match for the final state. */
  context?: Partial<FlowContext>;
  /** Data passed to the final step's handler. */
  data?: Record<string, unknown>;
  /** Execution state assertions. */
  execution?: Partial<ExecutionState>;
}

/**
 * A complete flow scenario — a declarative test definition.
 *
 * Scenarios are used with vitest's `it.each`:
 *   it.each([SCENARIO_A, SCENARIO_B])('$name', async (s) => runScenario(s));
 *
 * The `name` field appears in test output: "ecash send happy path: start → amount → sendComplete"
 *
 * @example
 * const HAPPY_PATH: FlowScenario = {
 *   name: 'ecash send happy path',
 *   steps: [
 *     { type: 'startSendEcash' },
 *     { type: 'enterAmount', amount: 100, mintUrl: MINT1 },
 *   ],
 *   waypoints: [{ afterStep: 0, step: 'enterAmount' }],
 *   expect: { step: 'sendComplete', context: { amount: 100 } },
 * };
 */
export interface FlowScenario {
  /** Human-readable scenario name (shown in test output). */
  name: string;
  /** Optional wallet state override. Merged with WALLETS.default. */
  wallet?: Partial<WalletContext>;
  /** Whether to run in offline mode. */
  offline?: boolean;
  /** Enables the optional ecash token memo step. */
  enableEcashSendMemo?: boolean;
  /** The sequence of user actions to execute. */
  steps: FlowAction[];
  /** The expected final state after all steps. */
  expect: FlowExpectation;
  /** Optional intermediate state assertions. */
  waypoints?: FlowWaypoint[];
}
