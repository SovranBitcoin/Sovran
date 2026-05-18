import { defaultDetectors } from '../detectors';
import { isMintOfflineError } from '../errors';
import { t } from '../formatting/locales';
import { errField, logger } from '../logger';
import { parseHistoryEntryOnce } from '../operations/historyEntry';
import { buildChooseProofsData, buildProofSuggestions } from './amountFallback';
import { transition } from './transitions';
import type { PaymentOption } from '../types';
import type {
  CreateMachineConfig,
  AmountEntryDisplayMetadata,
  Destination,
  ExecutionState,
  FlowContext,
  FlowStep,
  PaymentMachine,
  ProcessResult,
  RecipientProfile,
  ScanOptions,
  ScanSourceResult,
  StepDataMap,
} from './types';
import type { MintListItem } from '../types';

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
  let flowGeneration = 0;
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
    flowGeneration += 1;
    flowCtx = { unit: getUnit?.() ?? configUnit };
    setStep('idle', {});
    handlerExecuting = false;
    sendLocked = false;
    processedRef = false;
    pendingPaymentRequestConfirms = [];
    if (createURDecoder) {
      urDecoder = createURDecoder();
    }
  }

  function isStaleGeneration(generation: number, op: string): boolean {
    if (generation === flowGeneration) return false;
    logger.info('machine.stale_result.ignored', {
      op,
      generation,
      currentGeneration: flowGeneration,
      currentStep: step,
    });
    return true;
  }

  const notify = () => {
    const locale = getLocale?.() ?? 'en';
    cachedSnapshot = {
      ...deriveExecutionState(step, stepData, locale),
      isExecuting: handlerExecuting,
    };
    listeners.forEach((fn) => fn());
  };

  // ───────────────────────────────────────────────────────────────────────
  // Recipient identity resolvers (fire-and-forget)
  //
  // Stage 1: meltTarget → Nostr pubkey via `operations.resolveRecipientPubkey`
  //          (default = NIP-05 HTTP fetch, see recipient.ts).
  // Stage 2: pubkey → kind-0 profile via `operations.resolveRecipientProfile`
  //          (wallet-supplied; NDK / cache integration lives in the app).
  //
  // Both stages run as background side effects from `send()` once the
  // corresponding input lands on `flowCtx`. Stale guards re-check the
  // current ctx values before applying, so a meltTarget swap mid-flight
  // never leaks an out-of-date pubkey/profile.
  //
  // `flowCtx` and `stepData` are REPLACED (not mutated in place) when the
  // resolver applies new fields. React consumers subscribe via
  // `useSyncExternalStore(machine.subscribe, machine.getContext, …)`, and
  // that hook diffs snapshots with `Object.is` — in-place mutation keeps
  // the same reference and the subscriber skips the re-render, which is
  // what made the scan-LA flow appear broken while chat-launched flows
  // (where `recipientPubkey` is seeded into ctx at flow start) still
  // worked.
  // ───────────────────────────────────────────────────────────────────────

  function mirrorRecipientOntoStepData(): void {
    // Reflect the latest `flowCtx.recipientPubkey/Profile` onto whichever
    // step is currently active by REPLACING the `stepData` reference (so
    // any downstream consumer that diffs by identity sees a change). Each
    // affected step shape already declares the optional fields (see
    // `StepDataMap` in types.ts). Step shapes that don't carry recipient
    // identity (idle, confirmSend, mintQuoteCreated, etc.) are no-ops.
    const pk = flowCtx.recipientPubkey;
    const profile = flowCtx.recipientProfile;
    const withRecipientIdentity = <T extends Record<string, unknown>>(data: T) => ({
      ...data,
      ...(pk ? { recipientPubkey: pk } : {}),
      ...(profile ? { recipientProfile: profile } : {}),
    });

    switch (step) {
      case 'enterAmount': {
        const d = stepData as StepDataMap['enterAmount'];
        const nextData: StepDataMap['enterAmount'] = {
          ...d,
          constraints: {
            ...d.constraints,
            ...(pk ? { recipientPubkey: pk } : {}),
            ...(profile ? { recipientProfile: profile } : {}),
          },
        };
        stepData = nextData;
        return;
      }
      case 'selectMint':
      case 'chooseProofs':
      case 'sendComplete':
      case 'navigateToMeltPreview':
      case 'navigateToPaymentRequest': {
        const d = stepData as Record<string, unknown>;
        const nextData = withRecipientIdentity(d);
        stepData = nextData as StepDataMap[FlowStep];
        return;
      }
      default:
        return;
    }
  }

  function maybeResolveRecipient(
    prevMeltTarget: string | undefined,
    prevPubkey: string | undefined
  ): void {
    // Stage 1: meltTarget appeared (or changed) and no pubkey yet.
    const target = flowCtx.meltTarget;
    logger.info('machine.recipient.maybeResolve', {
      hasTarget: !!target,
      targetChanged: target !== prevMeltTarget,
      hasPubkey: !!flowCtx.recipientPubkey,
      hasResolvePubkey: !!operations?.resolveRecipientPubkey,
      hasResolveProfile: !!operations?.resolveRecipientProfile,
    });
    if (
      target &&
      target !== prevMeltTarget &&
      !flowCtx.recipientPubkey &&
      operations?.resolveRecipientPubkey
    ) {
      logger.info('machine.recipient.stage1.start', {
        targetPreview: target.slice(0, 30),
      });
      void (async () => {
        try {
          const pk = await operations!.resolveRecipientPubkey!(target);
          logger.info('machine.recipient.stage1.resolved', { hasPk: !!pk });
          if (!pk) return;
          if (flowCtx.meltTarget !== target) return; // stale guard
          if (flowCtx.recipientPubkey) return; // already set
          // Replace flowCtx so useSyncExternalStore subscribers see a fresh
          // reference. Mutating in place keeps the same closure-bound ref
          // and the snapshot diff is a no-op.
          flowCtx = { ...flowCtx, recipientPubkey: pk };
          mirrorRecipientOntoStepData();
          notify();
          // Chain into stage 2 immediately so the profile resolves without
          // waiting for the next transition.
          maybeResolveRecipient(target, undefined);
        } catch (err) {
          logger.warn('machine.recipient.resolvePubkey.threw', { error: errField(err) });
        }
      })();
    }

    // Stage 2: pubkey appeared (or changed) and no profile yet.
    const pubkey = flowCtx.recipientPubkey;
    if (
      pubkey &&
      pubkey !== prevPubkey &&
      !flowCtx.recipientProfile &&
      operations?.resolveRecipientProfile
    ) {
      logger.info('machine.recipient.stage2.start', {
        pubkeyPreview: pubkey.slice(0, 8),
      });
      void (async () => {
        try {
          const profile = await operations!.resolveRecipientProfile!(pubkey);
          logger.info('machine.recipient.stage2.resolved', {
            hasProfile: !!profile,
            displayName: profile?.displayName ?? null,
          });
          if (!profile) return;
          if (flowCtx.recipientPubkey !== pubkey) return; // stale guard
          if (flowCtx.recipientProfile) return;
          flowCtx = { ...flowCtx, recipientProfile: profile };
          mirrorRecipientOntoStepData();
          notify();
        } catch (err) {
          logger.warn('machine.recipient.resolveProfile.threw', { error: errField(err) });
        }
      })();
    }
  }

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

  function buildFallbackMintListItems(data: StepDataMap['selectMint']): MintListItem[] {
    return data.candidates.map((candidate) => ({
      mintUrl: candidate.mintUrl,
      displayName: candidate.mintUrl,
      balance: candidate.balance,
      unit: data.unit,
      status: 'available' as const,
      reason: null,
      isPreferred: false,
    }));
  }

  function startMintListEnrichment(
    data: StepDataMap['selectMint'],
    generation: number
  ): void {
    if (!operations?.buildMintListItems) return;

    void (async () => {
      try {
        const items = await operations.buildMintListItems(data);
        if (isStaleGeneration(generation, 'buildMintListItems')) return;
        if (step !== 'selectMint') return;
        const current = stepData as StepDataMap['selectMint'];
        setStep('selectMint', {
          ...current,
          mintListItems: items,
          mintListItemsStatus: 'ready',
        });
        notify();
      } catch (err) {
        if (isStaleGeneration(generation, 'buildMintListItems.catch')) return;
        if (step !== 'selectMint') return;
        logger.warn('machine.selectMint.enrichment.failed', { error: errField(err) });
        const current = stepData as StepDataMap['selectMint'];
        setStep('selectMint', {
          ...current,
          mintListItems: current.mintListItems ?? buildFallbackMintListItems(current),
          mintListItemsStatus: 'failed',
        });
        notify();
      }
    })();
  }

  const send = async (event: import('./types').FlowEvent): Promise<void> => {
    if (sendLocked) {
      logger.info('machine.event.ignored', { reason: 'locked', type: event.type });
      return;
    }
    sendLocked = true;
    const sendGeneration = flowGeneration;
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
        if (isStaleGeneration(sendGeneration, 'executeMelt')) return;
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
        if (isStaleGeneration(sendGeneration, 'executeMelt.catch')) return;
        logger.warn('machine.melt.failed', { error: errField(err) });
        routeOperationFailure(err, 'melt', data.meltTarget, data);
      }

      if (isStaleGeneration(sendGeneration, 'executeMelt.finalize')) return;
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
        if (!isStaleGeneration(sendGeneration, 'confirmMelt.unlock')) {
          sendLocked = false;
        }
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
        if (isStaleGeneration(sendGeneration, 'executePaymentRequest')) return;

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
        if (isStaleGeneration(sendGeneration, 'executePaymentRequest.catch')) return;
        logger.warn('machine.paymentRequest.failed', { error: errField(err) });
        settle(false);
        routeOperationFailure(err, 'paymentRequest', data.paymentRequest, data);
      }

      if (isStaleGeneration(sendGeneration, 'executePaymentRequest.finalize')) return;
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
        if (!isStaleGeneration(sendGeneration, 'confirmPaymentRequest.unlock')) {
          sendLocked = false;
        }
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
    // Capture recipient-identity ctx snapshot *before* the transition so the
    // post-transition resolver only fires when something actually changed.
    const prevMeltTarget = flowCtx.meltTarget;
    const prevRecipientPubkey = flowCtx.recipientPubkey;
    const result = transition(step, flowCtx, eventForTransition, detectors, walletCtx, unit, offline);

    flowCtx = result.context;
    setStep(result.step, result.data);
    if (step !== prevStep) {
      logger.info('machine.transition', { from: prevStep, to: step, eventType: event.type });
    }

    // Kick off NIP-05 + kind-0 resolution as a background side effect when
    // meltTarget/recipientPubkey first appear on ctx. Best-effort: failure
    // returns null silently, so the flow never blocks on identity lookup.
    maybeResolveRecipient(prevMeltTarget, prevRecipientPubkey);

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
            if (isStaleGeneration(sendGeneration, 'executeNfcSend')) return;

            void notifications?.onNfcPaymentProgress?.({ phase: 'writing' });
            await nfcAdapter.writeToken(nfcSendResult.token);
            if (isStaleGeneration(sendGeneration, 'nfc.writeToken')) return;
            await nfcAdapter.releaseSession();
            if (isStaleGeneration(sendGeneration, 'nfc.releaseSession')) return;

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

            setStep('sendComplete', {
              historyEntry: nfcSendResult.historyEntry,
              recipientPubkey: flowCtx.recipientPubkey,
              recipientProfile: flowCtx.recipientProfile,
            });
          } catch (err) {
            if (isStaleGeneration(sendGeneration, 'executeNfcSend.catch')) return;
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
        const walletCtx = getContext();
        const proofAmounts = walletCtx.proofAmounts[data.mintUrl] ?? [];
        const localProofs = buildProofSuggestions(proofAmounts, data.amount);
        const hasExactLocalProofs = proofAmounts.length > 0 && localProofs.exactMatch;
        const shouldCreateLocalTokenFirst = hasExactLocalProofs && !!operations.executeOfflineSend;
        const appOffline = (getOffline?.() ?? false) || flowCtx.offline === true;
        const forceLocalSend = appOffline || flowCtx.localProofSend === true;
        logger.info('machine.confirmSend.start', {
          mintUrl: data.mintUrl,
          amount: data.amount,
          hasExactLocalProofs,
          localFirst: shouldCreateLocalTokenFirst,
        });
        handlerExecuting = true;
        notify();
        try {
          if (shouldCreateLocalTokenFirst) {
            const result = await operations.executeOfflineSend!(data.mintUrl, data.amount);
            if (isStaleGeneration(sendGeneration, 'executeOfflineSend.localFirst')) return;
            logger.info('machine.send.localFirst.success');
            setStep('sendComplete', {
              historyEntry: result.historyEntry,
              createdOffline: true,
              mintWasOffline: flowCtx.mintUnreachableConfirmed ? true : undefined,
              recipientPubkey: flowCtx.recipientPubkey,
              recipientProfile: flowCtx.recipientProfile,
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
          } else if (forceLocalSend && operations.executeOfflineSend) {
            const error = new Error(t('MINT_UNREACHABLE', getLocale?.() ?? 'en'));
            error.name = 'MintFetchError';
            throw error;
          } else {
            const result = await operations.executeSend(data.mintUrl, data.amount);
            if (isStaleGeneration(sendGeneration, 'executeSend')) return;
            logger.info('machine.send.success');
            setStep('sendComplete', {
              historyEntry: result.historyEntry,
              recipientPubkey: flowCtx.recipientPubkey,
              recipientProfile: flowCtx.recipientProfile,
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
          }
        } catch (err) {
          if (isStaleGeneration(sendGeneration, 'executeSend.catch')) return;
          let handled = false;
          const mintUnreachableConfirmed =
            isMintOfflineError(err) && !forceLocalSend && !shouldCreateLocalTokenFirst;
          if (mintUnreachableConfirmed && !flowCtx.mintUnreachableConfirmed) {
            flowCtx = { ...flowCtx, mintUnreachableConfirmed: true };
          }

          // Phase 1: If mint is offline and exact proofs exist, auto offline send
          if (
            isMintOfflineError(err) &&
            operations.executeOfflineSend &&
            proofAmounts.length > 0
          ) {
            logger.info('machine.send.offlineFallback.attempt', { mintUrl: data.mintUrl });
            const built = buildProofSuggestions(proofAmounts, data.amount);
            if (built.exactMatch) {
              try {
                const result = await operations.executeOfflineSend(data.mintUrl, data.amount);
                if (isStaleGeneration(sendGeneration, 'executeOfflineSend')) return;
                logger.info('machine.send.offlineFallback.success');
                setStep('sendComplete', {
                  historyEntry: result.historyEntry,
                  createdOffline: true,
                  mintWasOffline:
                    mintUnreachableConfirmed || flowCtx.mintUnreachableConfirmed
                      ? true
                      : undefined,
                  recipientPubkey: flowCtx.recipientPubkey,
                  recipientProfile: flowCtx.recipientProfile,
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
                if (isStaleGeneration(sendGeneration, 'executeOfflineSend.catch')) return;
                logger.warn('machine.send.offlineFallback.failed', { error: errField(e) });
              }
            }
          }

          // Phase 2: Proof selector fallback (existing behavior)
          if (!handled && proofAmounts.length > 0) {
            const built = buildProofSuggestions(proofAmounts, data.amount);
            if (!built.exactMatch && built.hasSuggestion) {
              const chooseProofsData = buildChooseProofsData({
                mintUrl: data.mintUrl,
                amount: data.amount,
                unit: flowCtx.unit,
                proofAmounts,
                suggestions: built.suggestions,
                ctx: flowCtx,
              });
              setStep('chooseProofs', chooseProofsData);
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
          if (getOffline?.() ?? false) {
            const error = new Error(t('MINT_UNREACHABLE', getLocale?.() ?? 'en'));
            error.name = 'MintFetchError';
            throw error;
          }
          const result = await operations.executeMintQuote(data.mintUrl, data.amount, data.unit);
          if (isStaleGeneration(sendGeneration, 'executeMintQuote')) return;
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
          if (isStaleGeneration(sendGeneration, 'executeMintQuote.catch')) return;
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
        if (!data.mintListItems) {
          setStep('selectMint', {
            ...data,
            mintListItems: buildFallbackMintListItems(data),
            mintListItemsStatus: 'loading',
          });
          startMintListEnrichment(data, sendGeneration);
          notify();
        }
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
        if (isStaleGeneration(sendGeneration, 'buildMintReviewInfo')) return;
        if (reviewStep === 'reviewMint') {
          setStep('reviewMint', { ...(reviewData as StepDataMap['reviewMint']), mintInfo: info });
        } else {
          setStep('openMint', { ...(reviewData as StepDataMap['openMint']), mintInfo: info });
        }
      } catch (err) {
        if (isStaleGeneration(sendGeneration, 'buildMintReviewInfo.catch')) return;
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
        if (isStaleGeneration(sendGeneration, 'trustMint')) return;
      } catch (err) {
        if (isStaleGeneration(sendGeneration, 'trustMint.catch')) return;
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
        void notificationHandler(errorData);
      }
    }

    const trackExecuting = !INPUT_STEPS.has(step);
    if (trackExecuting) {
      handlerExecuting = true;
    }
    notify();

    try {
      await dispatchHandler(step, stepData);
      if (isStaleGeneration(sendGeneration, 'dispatchHandler')) return;
    } finally {
      if (isStaleGeneration(sendGeneration, 'dispatchHandler.finally')) return;
      if (trackExecuting) {
        handlerExecuting = false;
      }
      sendLocked = false;
      notify();
    }

    } catch (err) {
      // Safety net: release sendLocked so the machine doesn't permanently lock
      // if transition() or an operation throws before the inner finally runs.
      if (isStaleGeneration(sendGeneration, 'machine.transition.safetyNet')) return;
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
            void notifications?.onScanError?.(
              source,
              err instanceof Error ? err : new Error(String(err))
            );
            return { urInProgress: false };
          }

          if ('canceled' in result && result.canceled) {
            return { urInProgress: false };
          }
          if ('empty' in result && result.empty) {
            void notifications?.onScanEmpty?.(source);
            return { urInProgress: false };
          }
          if ('error' in result && result.error) {
            void notifications?.onScanError?.(source, result.error);
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
    opts?: {
      destination?: Destination;
      offline?: boolean;
      meltTarget?: string;
      recipientPubkey?: string;
      recipientProfile?: RecipientProfile;
      amountEntryDisplay?: AmountEntryDisplayMetadata;
    }
  ) =>
    send({
      type: 'AMOUNT_ENTERED',
      amount,
      mintUrl,
      destination: opts?.destination,
      offline: opts?.offline,
      meltTarget: opts?.meltTarget,
      recipientPubkey: opts?.recipientPubkey,
      recipientProfile: opts?.recipientProfile,
      amountEntryDisplay: opts?.amountEntryDisplay,
    });

  const chooseOption = (option: PaymentOption) => send({ type: 'OPTION_CHOSEN', option });

  const chooseProofs = (amount: number) => send({ type: 'PROOFS_CHOSEN', amount });

  const startSendEcash = (opts?: {
    reset?: boolean;
    meltTarget?: string;
    recipientPubkey?: string;
    recipientProfile?: RecipientProfile;
  }) => {
    if (opts?.reset) resetInternal();
    return send({
      type: 'START_SEND_ECASH',
      ...(opts?.meltTarget ? { meltTarget: opts.meltTarget } : {}),
      ...(opts?.recipientPubkey ? { recipientPubkey: opts.recipientPubkey } : {}),
      ...(opts?.recipientProfile ? { recipientProfile: opts.recipientProfile } : {}),
    });
  };

  const startReceiveLightning = (opts?: { reset?: boolean }) => {
    if (opts?.reset) resetInternal();
    return send({ type: 'START_RECEIVE_LIGHTNING' });
  };
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
