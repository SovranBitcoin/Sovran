import { defaultDetectors } from '../detectors';
import { isMintOfflineError } from '../errors';
import { t } from '../formatting/locales';
import { errField, logger } from '../logger';
import { composeSatoshis } from '../offline';
import { parseHistoryEntryOnce } from '../operations/historyEntry';
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

function deriveExecutionState(
  step: FlowStep,
  data: StepDataMap[FlowStep],
  locale: string = 'en'
): ExecutionState {
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
        message: t('OPTION_SELECTION_REQUIRED', locale),
        isExecutable: false,
        isExecuting: false,
        step,
        details: data as Record<string, unknown>,
      };

    case 'chooseFallbackOption':
      return {
        status: 'needsInput',
        code: 'FALLBACK_OPTION_REQUIRED',
        message: t('FALLBACK_OPTION_REQUIRED', locale),
        isExecutable: false,
        isExecuting: false,
        step,
        details: data as Record<string, unknown>,
      };

    case 'enterAmount':
      return {
        status: 'needsInput',
        code: 'NO_AMOUNT',
        message: t('NO_AMOUNT', locale),
        isExecutable: false,
        isExecuting: false,
        step,
        details: data as Record<string, unknown>,
      };

    case 'selectMint':
      return {
        status: 'needsInput',
        code: 'MINT_SELECTION_REQUIRED',
        message: t('MINT_SELECTION_REQUIRED', locale),
        isExecutable: false,
        isExecuting: false,
        step,
        details: data as Record<string, unknown>,
      };

    case 'chooseProofs':
      return {
        status: 'needsInput',
        code: 'PROOF_SELECTION_REQUIRED',
        message: t('PROOF_SELECTION_REQUIRED', locale),
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
        code === 'MINT_QUOTE_FAILED' ||
        code === 'MELT_FAILED' ||
        code === 'PAYMENT_REQUEST_FAILED' ||
        code === 'NFC_WRITE_FAILED' ||
        code === 'NFC_SESSION_LOST' ||
        code === 'NFC_READ_FAILED'
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
  'chooseFallbackOption',
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
    getLocale,
    unit: configUnit = 'sat',
    operations,
    notifications,
    createURDecoder,
    scanSources,
    nfcAdapter,
  } = config;

  let urDecoder: ReturnType<NonNullable<typeof createURDecoder>> | null =
    createURDecoder?.() ?? null;
  let processedRef = false;
  let lastScanSource: string | undefined;

  // `step` and `stepData` are written together via `setStep<S>(s, d)` so the
  // discriminated `StepDataMap` carries through every transition. Previously
  // each site cast through `as any`, defeating the union check and letting
  // typos like `mintListItems = items` silently mutate state behind a stale
  // `details` reference. The helper is the only legal seam for advancing the
  // step; readers narrow via `stepData as StepDataMap[S]` at the use site.
  let step: FlowStep = 'idle';
  let flowCtx: FlowContext = { unit: configUnit };
  const idleData: StepDataMap['idle'] = {};
  let stepData: StepDataMap[FlowStep] = idleData;
  let handlerExecuting = false;
  let sendLocked = false;
  // Per-call result holders for `confirmPaymentRequest`. Each invocation
  // pushes its own holder before awaiting `send`; the CONFIRM_PAYMENT_REQUEST
  // handler snapshots and drains holders right after acquiring `sendLocked`,
  // so concurrent callers blocked by the lock keep their own default and
  // never observe another call's outcome.
  let pendingPaymentRequestConfirms: { rolledBack: boolean }[] = [];
  const listeners = new Set<() => void>();

  function setStep<S extends FlowStep>(nextStep: S, data: StepDataMap[S]): void {
    step = nextStep;
    stepData = data as StepDataMap[FlowStep];
  }

  let cachedSnapshot: ExecutionState = deriveExecutionState('idle', idleData);

  function resetInternal() {
    flowCtx = { unit: getUnit?.() ?? configUnit };
    setStep('idle', {});
    handlerExecuting = false;
    processedRef = false;
    if (createURDecoder) {
      urDecoder = createURDecoder();
    }
  }

  const notify = () => {
    const locale = getLocale?.() ?? 'en';
    cachedSnapshot = {
      ...deriveExecutionState(step, stepData, locale),
      isExecuting: handlerExecuting,
    };
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

  // Helper: route an operation failure to BIP321 fallback or error.
  /**
   * Route an operation failure. For BIP321 multi-option flows, marks the
   * failed option and routes to fallback or ALL_OPTIONS_DISABLED error.
   * For single-option flows, notifies failure but keeps the current step
   * so the user can retry.
   */
  function routeOperationFailure(
    err: unknown,
    variant: 'melt' | 'paymentRequest',
    failedValue: string,
    data: { mintUrl: string; amount: number; unit: string },
    opts?: { rolledBack?: boolean }
  ): void {
    const message = isMintOfflineError(err)
      ? t('MINT_UNREACHABLE', getLocale?.() ?? 'en')
      : err instanceof Error ? err.message : `${variant === 'melt' ? 'Melt' : 'Payment request'} failed`;

    // Always notify failure so the processing notification is dismissed.
    void notifications?.onPaymentFailed?.({
      variant,
      mintUrl: data.mintUrl,
      amount: data.amount,
      unit: data.unit,
      message,
      rolledBack: opts?.rolledBack,
    });

    // BIP321 multi-option: route to fallback or exhausted error.
    if (flowCtx.originalOptions && flowCtx.originalOptions.length > 1) {
      const failedValues = [...(flowCtx.failedOptionValues ?? []), failedValue];
      flowCtx.failedOptionValues = failedValues;

      const reAnnotated = flowCtx.originalOptions.map((ao) =>
        failedValues.includes(ao.option.value)
          ? { ...ao, status: 'disabled' as const, reason: { code: 'FAILED' as const, message: 'Payment failed' } }
          : ao
      );

      const hasViable = reAnnotated.some((o) => o.status !== 'disabled');

      if (hasViable) {
        setStep('chooseFallbackOption', {
          parsed: flowCtx.parsed!,
          options: reAnnotated,
          unit: flowCtx.unit,
          failedOptionValues: failedValues,
          lastFailedMessage: message,
        });
        return;
      }

      setStep('error', { code: 'ALL_OPTIONS_DISABLED', message: 'All payment options have failed' });
      return;
    }

    // Single-option: stay on the current step so the user can retry.
    // Step is NOT changed — the Pay/Confirm button becomes active again.
  }

  const send = async (event: import('./types').FlowEvent): Promise<void> => {
    if (sendLocked) {
      logger.info('machine.event.ignored', { reason: 'locked', type: event.type });
      return;
    }
    sendLocked = true;
    logger.info('machine.event.received', { type: event.type, currentStep: step });

    // Handle CONFIRM_MELT/CONFIRM_PAYMENT_REQUEST directly — these bypass transition().
    // On success: stepData is updated with historyEntry but step stays unchanged
    //   (the user is already on the screen — no re-navigation needed).
    // On failure: step changes to chooseFallbackOption or error, and the handler is dispatched.

    // If the user opened the mint selector from a terminal step and dismissed
    // without selecting, the step is stuck on selectMint while the UI is still
    // showing the terminal screen. Restore the terminal step from context so
    // the CONFIRM_* guards can match.
    if (
      step === 'selectMint' &&
      (event.type === 'CONFIRM_MELT' || event.type === 'CONFIRM_PAYMENT_REQUEST') &&
      flowCtx.mintUrl &&
      flowCtx.amount
    ) {
      if (flowCtx.meltTarget) {
        setStep('navigateToMeltPreview', {
          mintUrl: flowCtx.mintUrl,
          meltTarget: flowCtx.meltTarget,
          amount: flowCtx.amount,
          unit: flowCtx.unit,
        });
      } else if (flowCtx.paymentRequest) {
        setStep('navigateToPaymentRequest', {
          mintUrl: flowCtx.mintUrl,
          paymentRequest: flowCtx.paymentRequest,
          amount: flowCtx.amount,
          unit: flowCtx.unit,
        });
      }
      notify();
    }

    if (event.type === 'CONFIRM_MELT' && step === 'navigateToMeltPreview' && operations?.executeMelt) {
      const originalStep = step;
      const data = stepData as StepDataMap['navigateToMeltPreview'];
      logger.info('machine.confirmMelt.start', {
        mintUrl: data.mintUrl,
        amount: data.amount,
        targetPreview: data.meltTarget?.slice(0, 30),
      });
      handlerExecuting = true;
      notify();

      void notifications?.onPaymentProcessing?.({
        variant: 'melt',
        mintUrl: data.mintUrl,
        amount: data.amount,
        unit: data.unit,
      });

      try {
        const result = await operations.executeMelt(data.mintUrl, data.meltTarget, data.amount, data.unit);
        logger.info('machine.melt.success', { mintUrl: data.mintUrl });

        const parsed = parseHistoryEntryOnce(result.historyEntry);
        if (operations.linkTransaction && parsed?.id) {
          operations.linkTransaction(data.meltTarget, parsed.id);
        }

        void notifications?.onPaymentConfirmed?.({
          variant: 'melt',
          mintUrl: data.mintUrl,
          amount: data.amount,
          unit: data.unit,
          historyEntry: result.historyEntry,
        });

        if (parsed?.id) {
          void notifications?.onTransactionCreated?.({
            transactionId: parsed.id,
            type: 'melt',
            mintUrl: data.mintUrl,
            amount: data.amount,
            unit: data.unit,
            rawInput: flowCtx.rawInput,
            source: flowCtx.source,
          });
          void notifications?.onMeltQuoteCreated?.({
            mintUrl: data.mintUrl,
            operationId: parsed.id,
            amount: data.amount,
            unit: data.unit,
            meltTarget: data.meltTarget,
          });
        }

        setStep('navigateToMeltPreview', { ...data, historyEntry: result.historyEntry });
      } catch (err) {
        logger.warn('machine.melt.failed', { error: errField(err) });
        routeOperationFailure(err, 'melt', data.meltTarget, data);
      }

      handlerExecuting = false;
      notify();

      // Hold sendLocked across dispatchHandler so a re-entrant CONFIRM_MELT
      // can't race the navigation. Mirrors the main-path try/finally below
      // (search for "Wrap the main transition path"); previously the lock was
      // released before dispatch, leaving an asymmetric window.
      try {
        if (step !== originalStep) {
          await dispatchHandler(step, stepData);
          notify();
        }
      } finally {
        sendLocked = false;
      }
      return;
    }

    if (event.type === 'CONFIRM_PAYMENT_REQUEST' && step === 'navigateToPaymentRequest' && operations?.executePaymentRequest) {
      const originalStep = step;
      const data = stepData as StepDataMap['navigateToPaymentRequest'];
      // Snapshot holders registered before this handler ran. Concurrent
      // callers that arrive during the await below hit the sendLocked guard
      // and resolve through their own holder (which never reaches this
      // snapshot) — the prior closure-variable design leaked one call's
      // result to a subsequent locked-out caller.
      const holders = pendingPaymentRequestConfirms;
      pendingPaymentRequestConfirms = [];
      const settle = (rolledBack: boolean) => {
        for (const h of holders) h.rolledBack = rolledBack;
      };
      logger.info('machine.confirmPaymentRequest.start', {
        mintUrl: data.mintUrl,
        amount: data.amount,
      });
      handlerExecuting = true;
      notify();

      void notifications?.onPaymentProcessing?.({
        variant: 'paymentRequest',
        mintUrl: data.mintUrl,
        amount: data.amount,
        unit: data.unit,
      });

      try {
        const result = await operations.executePaymentRequest(data.mintUrl, data.paymentRequest, data.amount, data.unit);

        if (result.rolledBack) {
          // Delivery failed but ecash was reclaimed — route through standard
          // failure path so BIP321 multi-option flows show the fallback selector.
          logger.warn('machine.paymentRequest.rolledBack', {
            mintUrl: data.mintUrl,
            errorMessage: result.errorMessage,
          });
          settle(true);
          routeOperationFailure(
            new Error(result.errorMessage ?? 'Delivery failed'),
            'paymentRequest',
            data.paymentRequest,
            data,
            { rolledBack: true },
          );
        } else {
          // Normal success path
          logger.info('machine.paymentRequest.success', { mintUrl: data.mintUrl });
          settle(false);

          const parsed = parseHistoryEntryOnce(result.historyEntry);
          if (operations.linkTransaction && parsed?.id) {
            operations.linkTransaction(data.paymentRequest, parsed.id);
          }

          void notifications?.onPaymentConfirmed?.({
            variant: 'paymentRequest',
            mintUrl: data.mintUrl,
            amount: data.amount,
            unit: data.unit,
            historyEntry: result.historyEntry,
          });

          if (parsed?.id) {
            void notifications?.onTransactionCreated?.({
              transactionId: parsed.id,
              type: 'send',
              mintUrl: data.mintUrl,
              amount: data.amount,
              unit: data.unit,
              rawInput: flowCtx.rawInput,
              source: flowCtx.source,
            });
          }

          setStep('navigateToPaymentRequest', { ...data, historyEntry: result.historyEntry });
        }
      } catch (err) {
        logger.warn('machine.paymentRequest.failed', { error: errField(err) });
        settle(false);
        routeOperationFailure(err, 'paymentRequest', data.paymentRequest, data);
      }

      handlerExecuting = false;
      notify();

      // Hold sendLocked across dispatchHandler so a re-entrant
      // CONFIRM_PAYMENT_REQUEST can't race the navigation. Same try/finally
      // shape as CONFIRM_MELT above and the main path's wrapper below.
      try {
        if (step !== originalStep) {
          await dispatchHandler(step, stepData);
          notify();
        }
      } finally {
        sendLocked = false;
      }
      return;
    }

    // Wrap the main transition path so sendLocked is always released,
    // even if transition() or an operation throws unexpectedly.
    try {
    const walletCtx = getContext();
    const unit = getUnit?.() ?? configUnit;

    // Resolve current offline status once per event. Passed into
    // transition() so every code path (EXECUTE, AMOUNT_ENTERED, etc.)
    // sees the real-time value from the provider.
    const offline = getOffline?.() ?? false;

    const eventForTransition =
      event.type === 'AMOUNT_ENTERED'
        ? {
            ...event,
            offline: event.offline ?? offline,
          }
        : event;

    const reviewMintData =
      event.type === 'MINT_TRUSTED' && step === 'reviewMint'
        ? (stepData as StepDataMap['reviewMint'])
        : null;

    // Capture original options before transition overwrites stepData.
    const preTransitionOptions =
      event.type === 'OPTION_CHOSEN' && (step === 'chooseOption' || step === 'chooseFallbackOption')
        ? (stepData as StepDataMap['chooseOption']).options
        : undefined;

    const prevStep = step;
    const result = transition(step, flowCtx, eventForTransition, detectors, walletCtx, unit, offline);

    flowCtx = result.context;
    setStep(result.step, result.data);
    if (step !== prevStep) {
      logger.info('machine.transition', { from: prevStep, to: step, eventType: event.type });
    }

    // Save BIP321 original options for fallback (first selection only).
    if (preTransitionOptions && preTransitionOptions.length > 1) {
      flowCtx.originalOptions = flowCtx.originalOptions ?? preTransitionOptions;
    }

    // Clear the scan dedup guard once we leave option-selection (e.g. user
    // picked an option, flow errored, etc.). Without this, processedRef stays
    // true after a BIP321 flow and all subsequent scan() calls are silently dropped.
    if (processedRef && step !== 'chooseOption' && step !== 'chooseFallbackOption') {
      processedRef = false;
    }

    if (event.type === 'EXECUTE') {
      const scanSource = lastScanSource;
      lastScanSource = undefined;
      flowCtx.source = scanSource;
      if (notifications?.onScanResolved && flowCtx.parsed) {
        const optionKinds = flowCtx.parsed.options.length > 0
          ? [...new Set(flowCtx.parsed.options.map((o) => o.kind))]
          : undefined;
        void notifications.onScanResolved({
          rawInput: event.input,
          parsedType: flowCtx.parsed.type ?? 'unknown',
          intentType: flowCtx.intent?.type ?? 'unknown',
          source: scanSource,
          container: flowCtx.parsed.container ?? undefined,
          optionKinds,
        });
      }
    }

    if (eventForTransition.type === 'AMOUNT_ENTERED') {
      const e = eventForTransition;
      if (e.amount > 0 && !String(e.mintUrl ?? '').trim()) {
        void notifications?.onMissingMintForAmount?.();
      }
    }

    // Mint selection notifications: scope 'npc' → onNpcMintChanged; else → onPreferredMintChanged when applicable.
    if (event.type === 'MINT_SELECTED') {
      if (event.scope === 'npc') {
        void notifications?.onNpcMintChanged?.({ mintUrl: event.mintUrl });
      } else {
        const isPersistOnlyPath = step === 'dismiss' && !flowCtx.destination;
        const shouldPersist = event.persist ?? isPersistOnlyPath;
        if (shouldPersist) {
          void notifications?.onPreferredMintChanged?.({ mintUrl: event.mintUrl });
        }
      }
    }

    // NFC auto-resolve: when source is 'nfc' and an adapter is available,
    // automatically resolve interactive steps (option choice, mint selection)
    // and auto-execute payment request sends with NFC write-back.
    if (flowCtx.source === 'nfc' && nfcAdapter) {
      let nfcResolved = false;

      // Loop because auto-resolving one step (e.g. chooseOption) may produce
      // another step (e.g. selectMint) that also needs auto-resolution.
      while (!nfcResolved) {
        if (step === 'chooseOption' || step === 'chooseFallbackOption') {
          const options = (stepData as StepDataMap['chooseOption']).options;
          const best =
            options.find((o) => o.option.kind === 'paymentRequest' && o.status !== 'disabled') ??
            options.find((o) => o.option.kind === 'lightningInvoice' && o.status !== 'disabled') ??
            options.find((o) => o.status !== 'disabled');
          if (best) {
            const walletCtxInner = getContext();
            const unitInner = getUnit?.() ?? configUnit;
            const r = transition(step, flowCtx, { type: 'OPTION_CHOSEN', option: best.option }, detectors, walletCtxInner, unitInner, offline);
            flowCtx = r.context;
            flowCtx.source = 'nfc';
            setStep(r.step, r.data);
            continue;
          }
          // No viable option
          nfcResolved = true;
        } else if (step === 'selectMint') {
          const data = stepData as StepDataMap['selectMint'];
          const best = data.candidates[0];
          if (best) {
            void notifications?.onNfcPaymentProgress?.({ phase: 'selecting' });
            const walletCtxInner = getContext();
            const unitInner = getUnit?.() ?? configUnit;
            const r = transition(step, flowCtx, { type: 'MINT_SELECTED', mintUrl: best.mintUrl }, detectors, walletCtxInner, unitInner, offline);
            flowCtx = r.context;
            flowCtx.source = 'nfc';
            setStep(r.step, r.data);
            continue;
          }
          // No candidates — will be handled by error dispatch below
          nfcResolved = true;
        } else if (step === 'enterAmount') {
          // NFC requires amount in payment request — if we reach enterAmount, the request lacked it
          await nfcAdapter.releaseSession();
          setStep('error', {
            code: 'NFC_READ_FAILED',
            message: 'Payment request must include an amount for NFC payment',
          });
          nfcResolved = true;
        } else if (step === 'navigateToPaymentRequest' && operations?.executeNfcSend) {
          // Auto-execute: create token → write back to NFC tag
          const data = stepData as StepDataMap['navigateToPaymentRequest'];
          handlerExecuting = true;
          notify();

          void notifications?.onNfcPaymentProgress?.({ phase: 'creating' });

          let nfcSendResult: { token: string; historyEntry: string; operationId: string } | null = null;
          try {
            nfcSendResult = await operations.executeNfcSend(data.mintUrl, data.amount);

            void notifications?.onNfcPaymentProgress?.({ phase: 'writing' });
            await nfcAdapter.writeToken(nfcSendResult.token);
            await nfcAdapter.releaseSession();

            const parsed = parseHistoryEntryOnce(nfcSendResult.historyEntry);
            // Link transaction for scan history provenance
            if (operations.linkTransaction && flowCtx.rawInput && parsed?.id) {
              operations.linkTransaction(flowCtx.rawInput, parsed.id);
            }

            void notifications?.onPaymentConfirmed?.({
              variant: 'send',
              mintUrl: data.mintUrl,
              amount: data.amount,
              unit: data.unit,
              historyEntry: nfcSendResult.historyEntry,
            });

            if (parsed?.id) {
              void notifications?.onTransactionCreated?.({
                transactionId: parsed.id,
                type: 'send',
                mintUrl: data.mintUrl,
                amount: data.amount,
                unit: data.unit,
                rawInput: flowCtx.rawInput,
                source: 'nfc',
              });
            }

            setStep('sendComplete', { historyEntry: nfcSendResult.historyEntry });
          } catch (err) {
            // Write-back or send failed — rollback if token was created
            let rolledBack = false;
            if (nfcSendResult && operations.rollbackSend) {
              try {
                await operations.rollbackSend(nfcSendResult.operationId);
                rolledBack = true;
              } catch { /* rollback best-effort */ }
            }
            await nfcAdapter.releaseSession();

            const message = err instanceof Error ? err.message : 'NFC write failed';
            void notifications?.onNfcWriteFailed?.({ message, rolledBack });

            setStep('error', { code: 'NFC_WRITE_FAILED', message });
          }

          handlerExecuting = false;
          nfcResolved = true;
        } else {
          // Terminal step that isn't navigateToPaymentRequest (e.g. navigateToMeltPreview,
          // error, receiveToken) — release NFC session and proceed normally.
          await nfcAdapter.releaseSession();
          nfcResolved = true;
        }
      }
    }

    // Intercept action steps when operations are provided.
    // The machine runs the operation internally, then re-targets to
    // a result step (sendComplete, mintQuoteCreated) or fallback (chooseProofs, error).
    if (operations) {
      if (step === 'confirmSend') {
        const data = stepData as StepDataMap['confirmSend'];
        logger.info('machine.confirmSend.start', {
          mintUrl: data.mintUrl,
          amount: data.amount,
        });
        handlerExecuting = true;
        notify();
        try {
          const result = await operations.executeSend(data.mintUrl, data.amount);
          logger.info('machine.send.success');
          setStep('sendComplete', { historyEntry: result.historyEntry });

          const parsed = parseHistoryEntryOnce(result.historyEntry);
          if (parsed?.id) {
            void notifications?.onTransactionCreated?.({
              transactionId: parsed.id,
              type: 'send',
              mintUrl: data.mintUrl,
              amount: data.amount,
              unit: flowCtx.unit,
              rawInput: flowCtx.rawInput,
              source: flowCtx.source,
            });
          }
        } catch (err) {
          const walletCtx = getContext();
          const proofAmounts = walletCtx.proofAmounts[data.mintUrl] ?? [];
          let handled = false;

          // Phase 1: If mint is offline and exact proofs exist, auto offline send
          if (
            isMintOfflineError(err) &&
            operations.executeOfflineSend &&
            proofAmounts.length > 0
          ) {
            logger.info('machine.send.offlineFallback.attempt', { mintUrl: data.mintUrl });
            const composition = composeSatoshis(proofAmounts, data.amount);
            if (composition.exactMatch) {
              try {
                const result = await operations.executeOfflineSend(data.mintUrl, data.amount);
                logger.info('machine.send.offlineFallback.success');
                setStep('sendComplete', {
                  historyEntry: result.historyEntry,
                  mintWasOffline: true,
                });

                const parsed = parseHistoryEntryOnce(result.historyEntry);
                if (parsed?.id) {
                  void notifications?.onTransactionCreated?.({
                    transactionId: parsed.id,
                    type: 'send',
                    mintUrl: data.mintUrl,
                    amount: data.amount,
                    unit: flowCtx.unit,
                    rawInput: flowCtx.rawInput,
                    source: flowCtx.source,
                  });
                }

                handled = true;
              } catch (e) {
                logger.warn('machine.send.offlineFallback.failed', { error: errField(e) });
              }
            }
          }

          // Phase 2: Proof selector fallback (existing behavior)
          if (!handled && proofAmounts.length > 0) {
            const composition = composeSatoshis(proofAmounts, data.amount);
            const hasOptions =
              composition.exactMatch ||
              composition.nearestLower != null ||
              composition.nearestUpper != null;
            if (hasOptions) {
              setStep('chooseProofs', {
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
              });
              handled = true;
            }
          }

          // Phase 3: Error
          if (!handled) {
            const mintUnreachable = isMintOfflineError(err);
            setStep('error', {
              code: 'SEND_FAILED',
              message: mintUnreachable
                ? t('MINT_UNREACHABLE', getLocale?.() ?? 'en')
                : err instanceof Error ? err.message : t('SEND_FAILED', getLocale?.() ?? 'en'),
              ...(mintUnreachable ? { data: { mintUnreachable: true } } : {}),
            });
          }
        }
        handlerExecuting = false;
        notify();
      } else if (step === 'createMintQuote') {
        const data = stepData as StepDataMap['createMintQuote'];
        logger.info('machine.createMintQuote.start', {
          mintUrl: data.mintUrl,
          amount: data.amount,
        });
        handlerExecuting = true;
        notify();
        try {
          const result = await operations.executeMintQuote(data.mintUrl, data.amount, data.unit);
          logger.info('machine.createMintQuote.success');
          setStep('mintQuoteCreated', { historyEntry: result.historyEntry, unit: data.unit });

          const parsed = parseHistoryEntryOnce(result.historyEntry);
          if (parsed?.id) {
            void notifications?.onTransactionCreated?.({
              transactionId: parsed.id,
              type: 'mint',
              mintUrl: data.mintUrl,
              amount: data.amount,
              unit: data.unit,
              rawInput: flowCtx.rawInput,
              source: flowCtx.source,
            });
          }
        } catch (err) {
          logger.warn('machine.createMintQuote.failed', { error: errField(err) });
          const mintUnreachable = isMintOfflineError(err);
          setStep('error', {
            code: 'MINT_QUOTE_FAILED',
            message: mintUnreachable
              ? t('MINT_UNREACHABLE', getLocale?.() ?? 'en')
              : err instanceof Error ? err.message : t('MINT_QUOTE_FAILED', getLocale?.() ?? 'en'),
            ...(mintUnreachable ? { data: { mintUnreachable: true } } : {}),
          });
        }
        handlerExecuting = false;
        notify();
      } else if (step === 'selectMint') {
        const data = stepData as StepDataMap['selectMint'];
        handlerExecuting = true;
        notify();
        try {
          const items = await operations.buildMintListItems(data);
          // Fresh ref so useSyncExternalStore consumers (and any details-keyed
          // useMemo) see the enrichment instead of reusing the stale snapshot.
          setStep('selectMint', { ...data, mintListItems: items });
        } catch (err) {
          setStep('error', {
            code: 'UNSUPPORTED_INPUT',
            message:
              err instanceof Error ? err.message : t('LOAD_MINTS_FAILED', getLocale?.() ?? 'en'),
          });
        }
        handlerExecuting = false;
        notify();
      }
    }

    // Review mint / open mint: load detailed mint info before dispatching the handler.
    if (
      (step === 'reviewMint' || step === 'openMint') &&
      operations?.buildMintReviewInfo
    ) {
      const reviewStep = step;
      const reviewData =
        reviewStep === 'reviewMint'
          ? (stepData as StepDataMap['reviewMint'])
          : (stepData as StepDataMap['openMint']);
      const mintUrl =
        reviewStep === 'reviewMint'
          ? (reviewData as StepDataMap['reviewMint']).mintUrl
          : (reviewData as StepDataMap['openMint']).url;
      handlerExecuting = true;
      notify();
      try {
        const info = await operations.buildMintReviewInfo(mintUrl);
        if (reviewStep === 'reviewMint') {
          setStep('reviewMint', { ...(reviewData as StepDataMap['reviewMint']), mintInfo: info });
        } else {
          setStep('openMint', { ...(reviewData as StepDataMap['openMint']), mintInfo: info });
        }
      } catch (err) {
        setStep('error', {
          code: 'UNSUPPORTED_INPUT',
          message:
            err instanceof Error ? err.message : t('LOAD_MINTS_FAILED', getLocale?.() ?? 'en'),
        });
      }
      handlerExecuting = false;
      notify();
    }

    // Trust mint operation: when MINT_TRUSTED transitions to receiveToken,
    // call operations.trustMint first. On failure, redirect to error.
    if (reviewMintData && operations?.trustMint && step === 'receiveToken') {
      handlerExecuting = true;
      notify();
      try {
        await operations.trustMint(reviewMintData.mintUrl);
      } catch (err) {
        setStep('error', {
          code: 'UNSUPPORTED_INPUT',
          message:
            err instanceof Error ? err.message : t('TRUST_MINT_FAILED', getLocale?.() ?? 'en'),
        });
      }
      handlerExecuting = false;
      notify();
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

    } catch (err) {
      // Safety net: release sendLocked so the machine doesn't permanently lock
      // if transition() or an operation throws before the inner finally runs.
      logger.warn('machine.transition.safetyNet', { error: errField(err) });
      sendLocked = false;
      handlerExecuting = false;
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
    if (opts?.reset) resetInternal();
    return send({ type: 'REQUEST_MINT_SELECTOR', scope: opts?.scope });
  };

  const execute = (input: string, opts?: { reset?: boolean }) => {
    if (opts?.reset) resetInternal();
    return send({ type: 'EXECUTE', input });
  };

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
          if (options?.reset) resetInternal();

          const hasData = data != null && data.length > 0;
          lastScanSource = options?.source ?? (hasData ? undefined : 'clipboard');

          if (hasData) {
            return processScanData(data);
          }

          const source = options?.source ?? 'clipboard';
          const sourceFn =
            source === 'clipboard'
              ? scanSources?.clipboard
              : source === 'gallery'
                ? scanSources?.gallery
                : source === 'nfc'
                  ? scanSources?.nfc
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
    opts?: { destination?: Destination; offline?: boolean; meltTarget?: string }
  ) =>
    send({
      type: 'AMOUNT_ENTERED',
      amount,
      mintUrl,
      destination: opts?.destination,
      offline: opts?.offline,
      meltTarget: opts?.meltTarget,
    });

  const chooseOption = (option: PaymentOption) => send({ type: 'OPTION_CHOSEN', option });

  const chooseProofs = (amount: number) => send({ type: 'PROOFS_CHOSEN', amount });

  const startSendEcash = (opts?: { reset?: boolean }) => {
    if (opts?.reset) resetInternal();
    return send({ type: 'START_SEND_ECASH' });
  };

  const startReceiveLightning = () => send({ type: 'START_RECEIVE_LIGHTNING' });
  const startReceive = (opts?: { reset?: boolean }) => {
    if (opts?.reset) resetInternal();
    return send({ type: 'START_RECEIVE' });
  };

  const reviewMint = (mintUrl: string, token: string) =>
    send({ type: 'REVIEW_MINT', mintUrl, token });

  const mintTrusted = () => send({ type: 'MINT_TRUSTED' });

  const confirmMelt = () => send({ type: 'CONFIRM_MELT' });
  const confirmPaymentRequest = async (): Promise<{ rolledBack: boolean }> => {
    // Per-call holder isolates this caller's result from any concurrent
    // confirmPaymentRequest the lock blocks. The handler writes only to
    // holders it snapshotted before its await, so a locked-out caller's
    // holder retains its default `{ rolledBack: false }`.
    const holder: { rolledBack: boolean } = { rolledBack: false };
    pendingPaymentRequestConfirms.push(holder);
    try {
      await send({ type: 'CONFIRM_PAYMENT_REQUEST' });
      return holder;
    } finally {
      const idx = pendingPaymentRequestConfirms.indexOf(holder);
      if (idx >= 0) pendingPaymentRequestConfirms.splice(idx, 1);
    }
  };

  const reset = () => {
    resetInternal();
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
    reviewMint,
    mintTrusted,
    confirmMelt,
    confirmPaymentRequest,
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
