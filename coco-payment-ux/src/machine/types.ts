import type {
  AnnotatedOption,
  MintCandidate,
  MintListItem,
  ParsedPaymentInput,
  PaymentOption,
  ResolvedIntent,
  WalletContext,
  AmountEntryConstraints,
  Detectors,
} from '../types';

// ---------------------------------------------------------------------------
// Flow Steps — every state the machine can be in
// ---------------------------------------------------------------------------

export type FlowStep =
  | 'idle'
  | 'chooseOption'
  | 'enterAmount'
  | 'selectMint'
  | 'chooseProofs'
  | 'receiveToken'
  | 'confirmSend'
  | 'sendComplete'
  | 'navigateToMeltPreview'
  | 'navigateToPaymentRequest'
  | 'createMintQuote'
  | 'mintQuoteCreated'
  | 'openMint'
  | 'openProfile'
  | 'dismiss'
  | 'error';

export type Destination = AmountEntryConstraints['destination'];

// ---------------------------------------------------------------------------
// Step Data — typed payload delivered to each handler
// ---------------------------------------------------------------------------

export interface StepDataMap {
  idle: Record<string, never>;
  chooseOption: {
    parsed: ParsedPaymentInput;
    options: AnnotatedOption[];
    unit: string;
  };
  enterAmount: {
    unit: string;
    preselectedMintUrl?: string;
    constraints: {
      destination: Destination;
      supportedMintUrls?: string[];
      paymentRequest?: string;
      meltTarget?: string;
    };
  };
  selectMint: {
    candidates: MintCandidate[];
    supportedMintUrls?: string[];
    amount?: number;
    unit: string;
    paymentRequest?: string;
    meltTarget?: string;
    destination?: Destination;
    /** Pre-computed mint list items (populated when machine operations are provided). */
    mintListItems?: MintListItem[];
  };
  chooseProofs: {
    mintUrl: string;
    amount: number;
    paymentRequest?: string;
    meltTarget?: string;
    unit: string;
    proofAmounts: number[];
    suggestions?: {
      roundDown: { amount: number } | null;
      roundUp: { amount: number } | null;
    };
  };
  receiveToken: { token: string };
  confirmSend: { mintUrl: string; amount: number };
  sendComplete: { historyEntry: string };
  navigateToMeltPreview: { mintUrl: string; meltTarget: string; unit: string; amount: number };
  navigateToPaymentRequest: { mintUrl: string; paymentRequest: string; amount: number; unit: string };
  createMintQuote: { mintUrl: string; amount: number; unit: string };
  mintQuoteCreated: { historyEntry: string; unit: string };
  openMint: { url: string };
  openProfile: { npub: string };
  dismiss: Record<string, never>;
  error: { code: ErrorCode; message: string; data?: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'NO_AMOUNT'
  | 'NO_VALID_MINT'
  | 'INSUFFICIENT_BALANCE'
  | 'NO_BALANCE'
  | 'UNSUPPORTED_INPUT'
  | 'ALL_OPTIONS_DISABLED'
  | 'MISSING_MELT_TARGET'
  | 'SEND_FAILED'
  | 'MINT_QUOTE_FAILED';

// ---------------------------------------------------------------------------
// Flow Context — accumulated data through the flow
// ---------------------------------------------------------------------------

export interface FlowContext {
  parsed?: ParsedPaymentInput;
  intent?: ResolvedIntent;
  amount?: number;
  mintUrl?: string;
  destination?: Destination;
  unit: string;
  paymentRequest?: string;
  meltTarget?: string;
  supportedMintUrls?: string[];
  /** When true, force offline send (proof selector) instead of online confirmSend. */
  offline?: boolean;
}

// ---------------------------------------------------------------------------
// Machine Snapshot — full state at a point in time
// ---------------------------------------------------------------------------

export interface MachineSnapshot<S extends FlowStep = FlowStep> {
  step: S;
  context: FlowContext;
  data: S extends keyof StepDataMap ? StepDataMap[S] : never;
}

// ---------------------------------------------------------------------------
// Execution State — derived from snapshot for UI consumption
// ---------------------------------------------------------------------------

export type ExecutionState =
  | {
      status: 'ready';
      code: 'READY';
      message: null;
      isExecutable: true;
      isExecuting: boolean;
      step: FlowStep;
      details?: Record<string, unknown>;
    }
  | {
      status: 'needsInput';
      code:
        | 'NO_AMOUNT'
        | 'MINT_SELECTION_REQUIRED'
        | 'OPTION_SELECTION_REQUIRED'
        | 'PROOF_SELECTION_REQUIRED';
      message: string;
      isExecutable: false;
      isExecuting: boolean;
      step: FlowStep;
      details?: Record<string, unknown>;
    }
  | {
      status: 'blocked';
      code:
        | 'UNSUPPORTED_INPUT'
        | 'NO_VALID_MINT'
        | 'INSUFFICIENT_BALANCE'
        | 'NO_BALANCE'
        | 'ALL_OPTIONS_DISABLED'
        | 'SEND_FAILED'
        | 'MINT_QUOTE_FAILED';
      message: string;
      isExecutable: false;
      isExecuting: boolean;
      step: FlowStep;
      details?: Record<string, unknown>;
    };

// ---------------------------------------------------------------------------
// Flow Events — user actions that drive the machine
// ---------------------------------------------------------------------------

export type FlowEvent =
  | { type: 'EXECUTE'; input: string }
  | { type: 'OPTION_CHOSEN'; option: PaymentOption }
  | { type: 'AMOUNT_ENTERED'; amount: number; mintUrl: string; destination?: Destination; offline?: boolean }
  | {
      type: 'MINT_SELECTED';
      mintUrl: string;
      amount?: number;
      destination?: Destination;
      /** When true, the wallet should persist this mint as the user's preferred mint. */
      persist?: boolean;
    }
  | { type: 'PROOFS_CHOSEN'; amount: number }
  | { type: 'REQUEST_MINT_SELECTOR' }
  | { type: 'START_SEND_ECASH' }
  | { type: 'START_RECEIVE_LIGHTNING' }
  | { type: 'RESET' };

// ---------------------------------------------------------------------------
// Step Handler Map — wallet provides one handler per step
// ---------------------------------------------------------------------------

type MaybeAsync = void | Promise<void>;

export type StepHandlerMap = {
  [K in FlowStep as K extends 'idle' ? never : K]?: (data: StepDataMap[K]) => MaybeAsync;
};

// ---------------------------------------------------------------------------
// Notification Handler Map — wallet provides handlers for informational popups
// ---------------------------------------------------------------------------

/**
 * Notification handlers for informational UI feedback (errors, warnings,
 * success messages). Unlike step handlers which drive navigation/flow,
 * notifications are fire-and-forget — the machine dispatches them but
 * does not wait for or depend on the result.
 *
 * The wallet decides how to present each notification (native alert,
 * custom toast, etc.). If no handler is registered for a key, the
 * notification is silently ignored.
 */
export type NotificationHandlerMap = {
  [K in ErrorCode]?: (data: StepDataMap['error']) => MaybeAsync;
};

// ---------------------------------------------------------------------------
// Machine operations — async side effects the machine runs internally
// ---------------------------------------------------------------------------

/**
 * Async callbacks the machine executes for action steps (confirmSend,
 * createMintQuote, selectMint). When provided, the machine handles
 * success/failure routing and only dispatches external handlers for the
 * resulting navigation/UI step.
 *
 * Backward compatible: when omitted, external handlers receive the raw
 * action step data (old behavior).
 */
export interface MachineOperations {
  executeSend: (mintUrl: string, amount: number) => Promise<{ historyEntry: string }>;
  executeMintQuote: (
    mintUrl: string,
    amount: number,
    unit: string
  ) => Promise<{ historyEntry: string }>;
  buildMintListItems: (data: StepDataMap['selectMint']) => Promise<MintListItem[]>;
}

// ---------------------------------------------------------------------------
// Machine configuration
// ---------------------------------------------------------------------------

export interface CreateMachineConfig {
  handlers: StepHandlerMap;
  detectors?: Detectors;
  getContext: () => WalletContext;
  getUnit?: () => string;
  unit?: string;
  /**
   * Called when the machine determines the mint selection should be persisted.
   * Auto-triggered on the persist-only path (no destination = home screen selection).
   * Can be forced via `changeMint(url, { persist: true })` or suppressed with `false`.
   */
  onPersistMint?: (mintUrl: string) => void;
  /**
   * Async operations the machine executes for action steps.
   * When provided, confirmSend/createMintQuote/selectMint are handled
   * internally and external handlers only receive result steps.
   */
  operations?: MachineOperations;
  /**
   * Notification handlers for informational UI feedback.
   * The machine dispatches notifications for error steps (and future
   * warning/success events). The wallet decides how to present them.
   * When omitted or when no handler matches, notifications are no-ops.
   */
  notifications?: NotificationHandlerMap;
}

// ---------------------------------------------------------------------------
// Machine interface
// ---------------------------------------------------------------------------

export interface PaymentMachine {
  /** Send any event to advance the machine. */
  send: (event: FlowEvent) => Promise<void>;
  /** Process scan/paste/lightning input. Parses and routes to the appropriate flow. */
  execute: (input: string) => Promise<void>;
  /** Submit amount and mint for the current flow. Pass `offline: true` to force proof selection. */
  enterAmount: (
    amount: number,
    mintUrl: string,
    opts?: { destination?: Destination; offline?: boolean }
  ) => Promise<void>;
  /** User selected one of multiple payment options (e.g. from chooseOption step). */
  chooseOption: (option: PaymentOption) => Promise<void>;
  /** User selected round-down or round-up amount from offline proof suggestions. */
  chooseProofs: (amount: number) => Promise<void>;
  /** Select a mint. Without `destination`, continues the current flow with the new mint. */
  changeMint: (mintUrl: string, opts?: { persist?: boolean }) => Promise<void>;
  /**
   * Open mint selector for current flow.
   * Pass `{ reset: true }` to clear stale flow context first (e.g. from home screen).
   */
  requestMintSelector: (opts?: { reset?: boolean }) => Promise<void>;
  /** Start a send ecash flow. Resets context, auto-selects mint, opens amount screen. */
  startSendEcash: () => Promise<void>;
  /** Start a receive lightning flow. Resets context, opens amount screen for mint quote. */
  startReceiveLightning: () => Promise<void>;
  /** Clear all flow state. */
  reset: () => void;
  /** Current execution state (stable reference between notifications). */
  inspect: () => ExecutionState;
  /** Current flow context (for mint availability, flow mint, etc.). */
  getContext: () => FlowContext;
  /** Current step. */
  getStep: () => FlowStep;
  /** Subscribe to state changes. Returns unsubscribe function. */
  subscribe: (listener: () => void) => () => void;
}
