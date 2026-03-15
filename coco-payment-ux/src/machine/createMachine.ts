import { defaultDetectors } from '../detectors';
import { transition } from './transitions';
import type {
  CreateMachineConfig,
  ExecutionState,
  FlowContext,
  FlowStep,
  PaymentMachine,
  StepDataMap,
} from './types';

// ---------------------------------------------------------------------------
// Derive ExecutionState from step
// ---------------------------------------------------------------------------

function deriveExecutionState(step: FlowStep, data: StepDataMap[FlowStep]): ExecutionState {
  switch (step) {
    case 'idle':
      return {
        status: 'ready',
        code: 'READY',
        message: null,
        isExecutable: true,
        isExecuting: false,
        step,
      };

    case 'chooseOption':
      return {
        status: 'needsInput',
        code: 'OPTION_SELECTION_REQUIRED',
        message: 'Option selection is required to continue',
        isExecutable: false,
        isExecuting: false,
        step,
        details: data as Record<string, unknown>,
      };

    case 'enterAmount':
      return {
        status: 'needsInput',
        code: 'NO_AMOUNT',
        message: 'Amount is required to continue',
        isExecutable: false,
        isExecuting: false,
        step,
        details: data as Record<string, unknown>,
      };

    case 'selectMint':
      return {
        status: 'needsInput',
        code: 'MINT_SELECTION_REQUIRED',
        message: 'Mint selection is required to continue',
        isExecutable: false,
        isExecuting: false,
        step,
        details: data as Record<string, unknown>,
      };

    case 'chooseProofs':
      return {
        status: 'needsInput',
        code: 'PROOF_SELECTION_REQUIRED',
        message: 'Proof selection is required to continue',
        isExecutable: false,
        isExecuting: false,
        step,
        details: data as Record<string, unknown>,
      };

    case 'error': {
      const errorData = data as StepDataMap['error'];
      const code = errorData.code;
      const blockedCode =
        code === 'NO_VALID_MINT' ||
        code === 'INSUFFICIENT_BALANCE' ||
        code === 'NO_BALANCE' ||
        code === 'ALL_OPTIONS_DISABLED' ||
        code === 'UNSUPPORTED_INPUT'
          ? code
          : ('UNSUPPORTED_INPUT' as const);
      return {
        status: 'blocked',
        code: blockedCode,
        message: errorData.message,
        isExecutable: false,
        isExecuting: false,
        step,
        details: errorData.data,
      };
    }

    // Terminal navigate steps
    default:
      return {
        status: 'ready',
        code: 'READY',
        message: null,
        isExecutable: true,
        isExecuting: false,
        step,
      };
  }
}

/**
 * Steps that represent "waiting for user input" -- handler dispatch should
 * not set isExecuting (no global spinner while user types an amount).
 */
const INPUT_STEPS = new Set<FlowStep>([
  'enterAmount',
  'selectMint',
  'chooseOption',
  'chooseProofs',
]);

// ---------------------------------------------------------------------------
// createPaymentMachine
// ---------------------------------------------------------------------------

export function createPaymentMachine(config: CreateMachineConfig): PaymentMachine {
  const {
    handlers,
    detectors = defaultDetectors,
    getContext,
    getUnit,
    unit: configUnit = 'sat',
    onPersistMint,
  } = config;

  let step: FlowStep = 'idle';
  let flowCtx: FlowContext = { unit: configUnit };
  let stepData: StepDataMap[FlowStep] = {} as any;
  let handlerExecuting = false;
  let sendLocked = false;
  const listeners = new Set<() => void>();

  let cachedSnapshot: ExecutionState = deriveExecutionState('idle', {} as any);

  const notify = () => {
    cachedSnapshot = { ...deriveExecutionState(step, stepData), isExecuting: handlerExecuting };
    listeners.forEach((fn) => fn());
  };

  async function dispatchHandler(targetStep: FlowStep, data: StepDataMap[FlowStep]): Promise<void> {
    const handler = (handlers as Record<string, ((d: any) => void | Promise<void>) | undefined>)[
      targetStep
    ];
    if (handler) {
      await handler(data);
    }
  }

  const send = async (event: import('./types').FlowEvent): Promise<void> => {
    if (sendLocked) {
      return;
    }
    sendLocked = true;

    const walletCtx = getContext();
    const unit = getUnit?.() ?? configUnit;

    const result = transition(step, flowCtx, event, detectors, walletCtx, unit);

    step = result.step;
    flowCtx = result.context;
    stepData = result.data;

    // Auto-persist on persist-only path (no destination = home screen selection).
    // Explicit event.persist overrides: true forces persist, false suppresses it.
    if (event.type === 'MINT_SELECTED' && onPersistMint) {
      const isPersistOnlyPath = step === 'dismiss' && !flowCtx.destination;
      const shouldPersist = event.persist ?? isPersistOnlyPath;
      if (shouldPersist) {
        onPersistMint(event.mintUrl);
      }
    }

    const trackExecuting = !INPUT_STEPS.has(step);
    if (trackExecuting) {
      handlerExecuting = true;
    }
    notify();

    try {
      await dispatchHandler(step, stepData);
    } finally {
      if (trackExecuting) {
        handlerExecuting = false;
      }
      sendLocked = false;
      notify();
    }
  };

  const changeMint = (mintUrl: string, opts?: { persist?: boolean }) => {
    return send({ type: 'MINT_SELECTED', mintUrl, persist: opts?.persist });
  };

  const requestMintSelector = (opts?: { reset?: boolean }) => {
    if (opts?.reset) {
      step = 'idle';
      flowCtx = { unit: getUnit?.() ?? configUnit };
      stepData = {} as any;
      handlerExecuting = false;
    }
    return send({ type: 'REQUEST_MINT_SELECTOR' });
  };

  const startSendEcash = () => send({ type: 'START_SEND_ECASH' });

  const startReceiveLightning = () => send({ type: 'START_RECEIVE_LIGHTNING' });

  const reset = () => {
    step = 'idle';
    flowCtx = { unit: getUnit?.() ?? configUnit };
    stepData = {} as any;
    handlerExecuting = false;
    notify();
  };

  return {
    send,
    changeMint,
    requestMintSelector,
    startSendEcash,
    startReceiveLightning,
    reset,
    inspect: () => cachedSnapshot,
    getContext: () => flowCtx,
    getStep: () => step,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
