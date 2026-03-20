import { defaultDetectors } from '../detectors';
import { composeSatoshis } from '../offline';
import { transition } from './transitions';
import type { PaymentOption } from '../types';
import type {
  CreateMachineConfig,
  Destination,
  ExecutionState,
  FlowContext,
  FlowStep,
  PaymentMachine,
  ProcessResult,
  ScanOptions,
  ScanSourceResult,
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
        code === 'UNSUPPORTED_INPUT' ||
        code === 'SEND_FAILED' ||
        code === 'MINT_QUOTE_FAILED'
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
    getOffline,
    unit: configUnit = 'sat',
    onPersistMint,
    onNpcMintChange,
    operations,
    notifications,
    createURDecoder,
    scanSources,
  } = config;

  let urDecoder: ReturnType<NonNullable<typeof createURDecoder>> | null =
    createURDecoder?.() ?? null;
  let processedRef = false;

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

    const eventForTransition =
      event.type === 'AMOUNT_ENTERED'
        ? {
            ...event,
            offline: event.offline ?? getOffline?.() ?? false,
          }
        : event;

    const result = transition(step, flowCtx, eventForTransition, detectors, walletCtx, unit);

    step = result.step;
    flowCtx = result.context;
    stepData = result.data;

    if (eventForTransition.type === 'AMOUNT_ENTERED') {
      const e = eventForTransition;
      if (e.amount > 0 && !String(e.mintUrl ?? '').trim()) {
        void notifications?.onMissingMintForAmount?.();
      }
    }

    // Mint selection callbacks: scope 'npc' → onNpcMintChange; else → onPersistMint when applicable.
    if (event.type === 'MINT_SELECTED') {
      if (event.scope === 'npc') {
        onNpcMintChange?.(event.mintUrl);
      } else if (onPersistMint) {
        const isPersistOnlyPath = step === 'dismiss' && !flowCtx.destination;
        const shouldPersist = event.persist ?? isPersistOnlyPath;
        if (shouldPersist) {
          onPersistMint(event.mintUrl);
        }
      }
    }

    // Intercept action steps when operations are provided.
    // The machine runs the operation internally, then re-targets to
    // a result step (sendComplete, mintQuoteCreated) or fallback (chooseProofs, error).
    if (operations) {
      if (step === 'confirmSend') {
        const data = stepData as StepDataMap['confirmSend'];
        handlerExecuting = true;
        notify();
        try {
          const result = await operations.executeSend(data.mintUrl, data.amount);
          step = 'sendComplete';
          stepData = result as any;
        } catch (err) {
          const walletCtx = getContext();
          const proofAmounts = walletCtx.proofAmounts[data.mintUrl] ?? [];
          let handled = false;
          if (proofAmounts.length > 0) {
            const composition = composeSatoshis(proofAmounts, data.amount);
            const hasOptions =
              composition.exactMatch ||
              composition.nearestLower != null ||
              composition.nearestUpper != null;
            if (hasOptions) {
              step = 'chooseProofs';
              stepData = {
                mintUrl: data.mintUrl,
                amount: data.amount,
                unit: flowCtx.unit,
                proofAmounts,
                suggestions: {
                  roundDown: composition.exactMatch
                    ? { amount: data.amount }
                    : composition.nearestLower != null
                      ? { amount: composition.nearestLower }
                      : null,
                  roundUp: composition.exactMatch
                    ? null
                    : composition.nearestUpper != null
                      ? { amount: composition.nearestUpper }
                      : null,
                },
              } as any;
              handled = true;
            }
          }
          if (!handled) {
            step = 'error';
            stepData = {
              code: 'SEND_FAILED',
              message: err instanceof Error ? err.message : 'Failed to create token',
            } as any;
          }
        }
        handlerExecuting = false;
        notify();
      } else if (step === 'createMintQuote') {
        const data = stepData as StepDataMap['createMintQuote'];
        handlerExecuting = true;
        notify();
        try {
          const result = await operations.executeMintQuote(data.mintUrl, data.amount, data.unit);
          step = 'mintQuoteCreated';
          stepData = { historyEntry: result.historyEntry, unit: data.unit } as any;
        } catch (err) {
          step = 'error';
          stepData = {
            code: 'MINT_QUOTE_FAILED',
            message: err instanceof Error ? err.message : 'Failed to create mint quote',
          } as any;
        }
        handlerExecuting = false;
        notify();
      } else if (step === 'selectMint') {
        const data = stepData as StepDataMap['selectMint'];
        handlerExecuting = true;
        notify();
        try {
          const items = await operations.buildMintListItems(data);
          (stepData as any).mintListItems = items;
        } catch (err) {
          step = 'error';
          stepData = {
            code: 'UNSUPPORTED_INPUT',
            message: err instanceof Error ? err.message : 'Failed to load mints',
          } as any;
        }
        handlerExecuting = false;
        notify();
      }
    }

    // Dispatch notification for error steps (fire-and-forget).
    if (step === 'error' && notifications) {
      const errorData = stepData as StepDataMap['error'];
      const notificationHandler = notifications[errorData.code];
      if (notificationHandler) {
        notificationHandler(errorData);
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

  const changeMint = (
    mintUrl: string,
    opts?: { persist?: boolean; scope?: 'npc' | 'selected' }
  ) => {
    return send({ type: 'MINT_SELECTED', mintUrl, persist: opts?.persist, scope: opts?.scope });
  };

  const requestMintSelector = (opts?: { reset?: boolean; scope?: 'npc' | 'selected' }) => {
    if (opts?.reset) {
      step = 'idle';
      flowCtx = { unit: getUnit?.() ?? configUnit };
      stepData = {} as any;
      handlerExecuting = false;
    }
    return send({ type: 'REQUEST_MINT_SELECTOR', scope: opts?.scope });
  };

  const execute = (input: string) => send({ type: 'EXECUTE', input });

  async function processScanData(data: string): Promise<ProcessResult> {
    const isUR = data.startsWith('ur:') || data.startsWith('UR:');
    if (isUR && createURDecoder && urDecoder) {
      urDecoder.receivePart(data);
      const nextProgress = urDecoder.getProgress();

      if (urDecoder.isComplete() && urDecoder.isSuccess()) {
        const decoded = urDecoder.resultUR().decodeCBOR();
        const decodedString = new TextDecoder().decode(decoded);
        await execute(decodedString);
        urDecoder = createURDecoder();
        return { urInProgress: false };
      }

      return { urInProgress: true, progress: nextProgress };
    }

    if (processedRef) {
      return { urInProgress: false };
    }

    processedRef = true;
    await execute(data);
    const state = cachedSnapshot;

    if (state.status !== 'needsInput' || state.code !== 'OPTION_SELECTION_REQUIRED') {
      processedRef = false;
    }

    return {
      urInProgress: false,
      lockedPending: state.status === 'needsInput' && state.code === 'OPTION_SELECTION_REQUIRED',
    };
  }

  const scan =
    createURDecoder || scanSources
      ? async (data?: string, options?: ScanOptions): Promise<ProcessResult> => {
          const hasData = data != null && data.length > 0;

          if (hasData) {
            return processScanData(data);
          }

          const source = options?.source ?? 'clipboard';
          const sourceFn =
            source === 'clipboard'
              ? scanSources?.clipboard
              : source === 'gallery'
                ? scanSources?.gallery
                : undefined;

          if (!sourceFn) {
            return { urInProgress: false };
          }

          let result: ScanSourceResult;
          try {
            result = await sourceFn();
          } catch (err) {
            notifications?.onScanError?.(
              source,
              err instanceof Error ? err : new Error(String(err))
            );
            return { urInProgress: false };
          }

          if ('canceled' in result && result.canceled) {
            return { urInProgress: false };
          }
          if ('empty' in result && result.empty) {
            notifications?.onScanEmpty?.(source);
            return { urInProgress: false };
          }
          if ('error' in result && result.error) {
            notifications?.onScanError?.(source, result.error);
            return { urInProgress: false };
          }
          if ('data' in result && result.data) {
            return processScanData(result.data);
          }

          return { urInProgress: false };
        }
      : undefined;

  const enterAmount = (
    amount: number,
    mintUrl: string,
    opts?: { destination?: Destination; offline?: boolean }
  ) =>
    send({
      type: 'AMOUNT_ENTERED',
      amount,
      mintUrl,
      destination: opts?.destination,
      offline: opts?.offline,
    });

  const chooseOption = (option: PaymentOption) => send({ type: 'OPTION_CHOSEN', option });

  const chooseProofs = (amount: number) => send({ type: 'PROOFS_CHOSEN', amount });

  const startSendEcash = () => send({ type: 'START_SEND_ECASH' });

  const startReceiveLightning = () => send({ type: 'START_RECEIVE_LIGHTNING' });
  const startReceive = () => send({ type: 'START_RECEIVE' });

  const reset = () => {
    step = 'idle';
    flowCtx = { unit: getUnit?.() ?? configUnit };
    stepData = {} as any;
    handlerExecuting = false;
    processedRef = false;
    if (createURDecoder) {
      urDecoder = createURDecoder();
    }
    notify();
  };

  return {
    send,
    execute,
    scan,
    enterAmount,
    chooseOption,
    chooseProofs,
    changeMint,
    requestMintSelector,
    startSendEcash,
    startReceiveLightning,
    startReceive,
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
