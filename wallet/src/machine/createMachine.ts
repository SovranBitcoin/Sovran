import { defaultDetectors } from "../detectors";
import { isMeltUserCancelledError, isMintOfflineError } from "../errors";
import { t } from "../formatting/locales";
import { compareMintDisplayOrder } from "../mint-capabilities";
import { errField, logger, mintUrlFields } from "../logger";
import { buildProofSuggestions } from "./amountFallback";
import {
  runConfirmMeltEffect,
  runConfirmPaymentRequestEffect,
  runConfirmSendEffect,
  runMeltQuotePreviewEffect,
  runMintListEnrichmentEffect,
  runMintReviewInfoEffect,
  runMintQuoteEffect,
  runPaymentRequestReceiveEffect,
  runNfcWriteBackEffect,
  runRecipientProfileEffect,
  runRecipientPubkeyEffect,
  runTrustMintEffect,
} from "./effects";
import { transition } from "./transitions";
import { meltMethodForTarget } from "../melt-target";
import { meltQuotePreviewMatches } from "./meltQuotePreview";
import type { UnitAmount } from "../amount-actions";
import type { MintListItem, PaymentOption } from "../types";
import type {
  CreateMachineConfig,
  AmountEntryDisplayMetadata,
  Destination,
  ExecutionState,
  FlowContext,
  FlowStep,
  MeltQuoteMethod,
  MintQuoteMethod,
  MintSelectorScope,
  PaymentMachine,
  ProcessResult,
  RecipientProfile,
  ScanOptions,
  ScanSourceResult,
  SendEntrySource,
  StepDataMap,
} from "./types";

// ---------------------------------------------------------------------------
// Derive ExecutionState from step
// ---------------------------------------------------------------------------

function deriveExecutionState(
  step: FlowStep,
  data: StepDataMap[FlowStep],
  locale: string = "en",
): ExecutionState {
  switch (step) {
    case "idle":
      return {
        status: "ready",
        code: "READY",
        message: null,
        isExecutable: true,
        isExecuting: false,
        step,
      };

    case "chooseOption":
      return {
        status: "needsInput",
        code: "OPTION_SELECTION_REQUIRED",
        message: t("OPTION_SELECTION_REQUIRED", locale),
        isExecutable: false,
        isExecuting: false,
        step,
        details: data as Record<string, unknown>,
      };

    case "chooseFallbackOption":
      return {
        status: "needsInput",
        code: "FALLBACK_OPTION_REQUIRED",
        message: t("FALLBACK_OPTION_REQUIRED", locale),
        isExecutable: false,
        isExecuting: false,
        step,
        details: data as Record<string, unknown>,
      };

    case "enterAmount":
      return {
        status: "needsInput",
        code: "NO_AMOUNT",
        message: t("NO_AMOUNT", locale),
        isExecutable: false,
        isExecuting: false,
        step,
        details: data as Record<string, unknown>,
      };

    case "selectMint":
      return {
        status: "needsInput",
        code: "MINT_SELECTION_REQUIRED",
        message: t("MINT_SELECTION_REQUIRED", locale),
        isExecutable: false,
        isExecuting: false,
        step,
        details: data as Record<string, unknown>,
      };

    case "chooseProofs":
    case "enterSendMemo":
      return {
        status: "needsInput",
        code:
          step === "chooseProofs"
            ? "PROOF_SELECTION_REQUIRED"
            : "SEND_MEMO_REQUIRED",
        message:
          step === "chooseProofs"
            ? t("PROOF_SELECTION_REQUIRED", locale)
            : t("SEND_MEMO_REQUIRED", locale),
        isExecutable: false,
        isExecuting: false,
        step,
        details: data as Record<string, unknown>,
      };

    case "error": {
      const errorData = data as StepDataMap["error"];
      const code = errorData.code;
      const blockedCode =
        code === "NO_VALID_MINT" ||
        code === "INSUFFICIENT_BALANCE" ||
        code === "NO_BALANCE" ||
        code === "ALL_OPTIONS_DISABLED" ||
        code === "UNSUPPORTED_INPUT" ||
        code === "UNSUPPORTED_PAYMENT_METHOD" ||
        code === "SEND_FAILED" ||
        code === "MINT_QUOTE_FAILED" ||
        code === "MELT_FAILED" ||
        code === "PAYMENT_REQUEST_FAILED" ||
        code === "NFC_WRITE_FAILED" ||
        code === "NFC_SESSION_LOST" ||
        code === "NFC_READ_FAILED"
          ? code
          : ("UNSUPPORTED_INPUT" as const);
      return {
        status: "blocked",
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
        status: "ready",
        code: "READY",
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
  "enterAmount",
  "selectMint",
  "chooseOption",
  "chooseFallbackOption",
  "chooseProofs",
  "enterSendMemo",
]);

/**
 * Events that carry fresh user intent. The router never tells the machine
 * about back navigation, so a screen belonging to an EARLIER step can be
 * re-driven while a prior send() still awaits a *resolve* effect (quote
 * creation, mint info). When one of these events arrives during that window
 * it supersedes the in-flight work instead of being dropped: the flow
 * generation bump makes every pending continuation stale (success and
 * failure results are both discarded on arrival) and the new event is
 * processed immediately. CONFIRM_MELT / CONFIRM_PAYMENT_REQUEST are
 * deliberately absent — while money is moving, a later tap must never win.
 */
const INTENT_EVENTS = new Set<import("./types").FlowEvent["type"]>([
  "EXECUTE",
  "OPTION_CHOSEN",
  "AMOUNT_ENTERED",
  "MINT_SELECTED",
  // PROOFS_CHOSEN and SEND_MEMO_SUBMITTED are deliberately absent: they are
  // responses to machine-rendered steps (chooseProofs / enterSendMemo), not
  // fresh intent — accepted mid-resolve they superseded in-flight work and
  // could force a bogus error state (BTC-12).
  "REQUEST_MINT_SELECTOR",
  "START_SEND_ECASH",
  "START_SEND",
  "START_RECEIVE_LIGHTNING",
  "START_RECEIVE",
  "SHOW_RECEIVE_QR",
  "REVIEW_MINT",
  "MINT_TRUSTED",
  "RESET",
]);

// ---------------------------------------------------------------------------
// createPaymentMachine
// ---------------------------------------------------------------------------

export function createPaymentMachine(
  config: CreateMachineConfig,
): PaymentMachine {
  const {
    handlers,
    detectors = defaultDetectors,
    getContext,
    getUnit,
    getOffline,
    getSatsPerUnitMinor,
    enableEcashSendMemo = false,
    getLocale,
    unit: configUnit = "sat",
    operations,
    notifications,
    createURDecoder,
    scanSources,
    nfcAdapter,
  } = config;

  let urDecoder: ReturnType<NonNullable<typeof createURDecoder>> | null =
    createURDecoder?.() ?? null;
  let processedScanInput: string | null = null;
  let lastScanSource: string | undefined;

  // `step` and `stepData` are written together via `setStep<S>(s, d)` so the
  // discriminated `StepDataMap` carries through every transition. Previously
  // each site cast through `as any`, defeating the union check and letting
  // typos like `mintListItems = items` silently mutate state behind a stale
  // `details` reference. The helper is the only legal seam for advancing the
  // step; readers narrow via `stepData as StepDataMap[S]` at the use site.
  let step: FlowStep = "idle";
  let flowCtx: FlowContext = { unit: configUnit };
  const idleData: StepDataMap["idle"] = {};
  let stepData: StepDataMap[FlowStep] = idleData;
  let handlerExecuting = false;
  let sendLocked = false;
  // True only while an irreversible operation is actually executing
  // (send/melt/payment-request delivery, NFC write-back). Distinguishes
  // "locked because money is moving" (events must drop) from "locked because
  // a resolve effect is slow" (fresh user intent supersedes, see
  // INTENT_EVENTS).
  // Generation that currently owns an irreversible operation. A reset may
  // start a newer flow before the old promise settles, so an older finally
  // must never clear the newer generation's commit guard.
  let commitGeneration: number | null = null;
  let flowGeneration = 0;
  // Per-call result holders for `confirmPaymentRequest`. Each invocation
  // pushes its own holder before awaiting `send`; the CONFIRM_PAYMENT_REQUEST
  // handler snapshots and drains holders right after acquiring `sendLocked`,
  // so concurrent callers blocked by the lock keep their own default and
  // never observe another call's outcome.
  let pendingPaymentRequestConfirms: { rolledBack: boolean }[] = [];
  const listeners = new Set<() => void>();

  function setStep<S extends FlowStep>(
    nextStep: S,
    data: StepDataMap[S],
  ): void {
    step = nextStep;
    stepData = data as StepDataMap[FlowStep];
  }

  let cachedSnapshot: ExecutionState = deriveExecutionState("idle", idleData);

  function resetInternal() {
    flowGeneration += 1;
    flowCtx = { unit: getUnit?.() ?? configUnit };
    setStep("idle", {});
    handlerExecuting = false;
    sendLocked = false;
    processedScanInput = null;
    lastScanSource = undefined;
    pendingPaymentRequestConfirms = [];
    if (createURDecoder) {
      urDecoder = createURDecoder();
    }
  }

  function isStaleGeneration(generation: number, op: string): boolean {
    if (generation === flowGeneration) return false;
    logger.info("machine.stale_result.ignored", {
      op,
      generation,
      currentGeneration: flowGeneration,
      currentStep: step,
    });
    return true;
  }

  const notify = () => {
    const locale = getLocale?.() ?? "en";
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
    const p2pkLockPubkey = flowCtx.p2pkLockPubkey;
    const withRecipientIdentity = <T extends Record<string, unknown>>(
      data: T,
    ) => ({
      ...data,
      ...(pk ? { recipientPubkey: pk } : {}),
      ...(profile ? { recipientProfile: profile } : {}),
    });

    switch (step) {
      case "enterAmount": {
        const d = stepData as StepDataMap["enterAmount"];
        const nextData: StepDataMap["enterAmount"] = {
          ...d,
          constraints: {
            ...d.constraints,
            ...(pk ? { recipientPubkey: pk } : {}),
            ...(profile ? { recipientProfile: profile } : {}),
            ...(p2pkLockPubkey ? { p2pkLockPubkey } : {}),
          },
        };
        stepData = nextData;
        return;
      }
      case "selectMint":
      case "chooseProofs":
      case "sendComplete":
      case "navigateToMeltPreview":
      case "navigateToPaymentRequest": {
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
    prevPubkey: string | undefined,
  ): void {
    // Stage 1: meltTarget appeared (or changed) and no pubkey yet.
    const target = flowCtx.meltTarget;
    logger.info("machine.recipient.maybeResolve", {
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
      const resolveRecipientPubkey = operations.resolveRecipientPubkey;
      const recipientGeneration = flowGeneration;
      logger.info("machine.recipient.stage1.start", {
        targetPreview: target.slice(0, 30),
      });
      void (async () => {
        const effect = await runRecipientPubkeyEffect({
          target,
          operation: resolveRecipientPubkey,
          isStale: (op) => isStaleGeneration(recipientGeneration, op),
        });

        if (effect.isOk()) {
          logger.info("machine.recipient.stage1.resolved", {
            hasPk: effect.value.kind === "resolved",
          });
          if (effect.value.kind !== "resolved") return;
          if (flowCtx.meltTarget !== target) return; // stale guard
          if (flowCtx.recipientPubkey) return; // already set
          // Replace flowCtx so useSyncExternalStore subscribers see a fresh
          // reference. Mutating in place keeps the same closure-bound ref
          // and the snapshot diff is a no-op.
          flowCtx = { ...flowCtx, recipientPubkey: effect.value.pubkey };
          mirrorRecipientOntoStepData();
          notify();
          // Chain into stage 2 immediately so the profile resolves without
          // waiting for the next transition.
          maybeResolveRecipient(target, undefined);
        } else {
          logger.warn("machine.recipient.resolvePubkey.threw", {
            error: errField(effect.error.cause),
          });
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
      const resolveRecipientProfile = operations.resolveRecipientProfile;
      const recipientGeneration = flowGeneration;
      logger.info("machine.recipient.stage2.start", {
        pubkeyPreview: pubkey.slice(0, 8),
      });
      void (async () => {
        const effect = await runRecipientProfileEffect({
          pubkey,
          operation: resolveRecipientProfile,
          isStale: (op) => isStaleGeneration(recipientGeneration, op),
        });

        if (effect.isOk()) {
          logger.info("machine.recipient.stage2.resolved", {
            hasProfile: effect.value.kind === "resolved",
            displayName:
              effect.value.kind === "resolved"
                ? effect.value.profile.displayName
                : null,
          });
          if (effect.value.kind !== "resolved") return;
          if (flowCtx.recipientPubkey !== pubkey) return; // stale guard
          if (flowCtx.recipientProfile) return;
          flowCtx = { ...flowCtx, recipientProfile: effect.value.profile };
          mirrorRecipientOntoStepData();
          notify();
        } else {
          logger.warn("machine.recipient.resolveProfile.threw", {
            error: errField(effect.error.cause),
          });
        }
      })();
    }
  }

  async function dispatchHandler(
    targetStep: FlowStep,
    data: StepDataMap[FlowStep],
  ): Promise<void> {
    const handler = (
      handlers as Record<string, ((d: any) => void | Promise<void>) | undefined>
    )[targetStep];
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
    variant: "melt" | "paymentRequest",
    failedValue: string,
    data: { mintUrl: string; amount: number; unit: string },
    opts?: { rolledBack?: boolean },
  ): void {
    // A deliberate user cancel (e.g. dismissed fee sheet, nothing reserved)
    // dismisses the processing indicator quietly — no failure toast, and the
    // user stays on the preview step to retry or back out.
    if (isMeltUserCancelledError(err)) {
      logger.info("machine.operationFailure.userCancelled", { variant });
      void notifications?.onPaymentCancelled?.({
        variant,
        mintUrl: data.mintUrl,
        amount: data.amount,
        unit: data.unit,
      });
      return;
    }

    const message = isMintOfflineError(err)
      ? t("MINT_UNREACHABLE", getLocale?.() ?? "en")
      : err instanceof Error
        ? err.message
        : `${variant === "melt" ? "Melt" : "Payment request"} failed`;

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
          ? {
              ...ao,
              status: "disabled" as const,
              reason: { code: "FAILED" as const, message: "Payment failed" },
            }
          : ao,
      );

      const hasViable = reAnnotated.some((o) => o.status !== "disabled");

      if (hasViable) {
        setStep("chooseFallbackOption", {
          parsed: flowCtx.parsed!,
          options: reAnnotated,
          unit: flowCtx.unit,
          failedOptionValues: failedValues,
          lastFailedMessage: message,
        });
        return;
      }

      setStep("error", {
        code: "ALL_OPTIONS_DISABLED",
        message: "All payment options have failed",
      });
      return;
    }

    // Single-option: stay on the current step so the user can retry.
    // Step is NOT changed — the Pay/Confirm button becomes active again.
  }

  function buildFallbackMintListItems(
    data: StepDataMap["selectMint"],
  ): MintListItem[] {
    // Sorted with the SAME comparator the async enrichment uses, so the
    // first painted frame is already in the final order and the enriched
    // rows land without re-shuffling the list.
    return data.candidates
      .map((candidate) => ({
        mintUrl: candidate.mintUrl,
        displayName: candidate.mintUrl,
        balance: candidate.balance,
        unit: data.unit,
        status: candidate.status ?? ("available" as const),
        reason: candidate.reason ?? null,
        isPreferred: false,
      }))
      .sort(compareMintDisplayOrder);
  }

  function startMintListEnrichment(
    data: StepDataMap["selectMint"],
    generation: number,
  ): Promise<void> | null {
    if (!operations?.buildMintListItems) return null;

    const task = (async () => {
      const effect = await runMintListEnrichmentEffect({
        data,
        operation: operations.buildMintListItems,
        isStale: (op) => isStaleGeneration(generation, op),
      });

      if (effect.isOk()) {
        if (effect.value.kind === "stale") return;
        if (step !== "selectMint") return;
        const current = stepData as StepDataMap["selectMint"];
        setStep("selectMint", {
          ...current,
          mintListItems: effect.value.items,
          mintListItemsStatus: "ready",
        });
        notify();
      } else {
        if (step !== "selectMint") return;
        logger.warn("machine.selectMint.enrichment.failed", {
          error: errField(effect.error.cause),
        });
        const current = stepData as StepDataMap["selectMint"];
        setStep("selectMint", {
          ...current,
          mintListItems:
            current.mintListItems ?? buildFallbackMintListItems(current),
          mintListItemsStatus: "failed",
        });
        notify();
      }
    })();

    void task;
    return task;
  }

  const send = async (event: import("./types").FlowEvent): Promise<void> => {
    if (sendLocked) {
      const commitInFlight = commitGeneration === flowGeneration;
      if (commitInFlight || !INTENT_EVENTS.has(event.type)) {
        logger.info("machine.event.ignored", {
          reason: commitInFlight ? "commit-in-flight" : "locked",
          type: event.type,
        });
        return;
      }
      // Supersede the in-flight resolve work: the generation bump strands
      // every continuation of the prior send() at its next stale check (it
      // returns without unlocking — this call now owns the lock).
      flowGeneration += 1;
      handlerExecuting = false;
      logger.info("machine.event.superseded", {
        type: event.type,
        currentStep: step,
      });
    }
    sendLocked = true;
    const sendGeneration = flowGeneration;
    logger.info("machine.event.received", {
      type: event.type,
      currentStep: step,
      flowSource: flowCtx.source,
      intentType: flowCtx.intent?.type,
      hasMintUrl: !!flowCtx.mintUrl,
      hasAmount: flowCtx.amount != null,
      unit: flowCtx.unit,
    });

    // Handle CONFIRM_MELT/CONFIRM_PAYMENT_REQUEST directly — these bypass transition().
    // On success: stepData is updated with historyEntry but step stays unchanged
    //   (the user is already on the screen — no re-navigation needed).
    // On failure: step changes to chooseFallbackOption or error, and the handler is dispatched.

    // If the user opened the mint selector from a terminal step and dismissed
    // without selecting, the step is stuck on selectMint while the UI is still
    // showing the terminal screen. Restore the terminal step from context so
    // the CONFIRM_* guards can match.
    if (
      step === "selectMint" &&
      (event.type === "CONFIRM_MELT" ||
        event.type === "CONFIRM_PAYMENT_REQUEST") &&
      flowCtx.mintUrl &&
      flowCtx.amount
    ) {
      if (flowCtx.meltTarget) {
        setStep("navigateToMeltPreview", {
          mintUrl: flowCtx.mintUrl,
          meltTarget: flowCtx.meltTarget,
          amount: flowCtx.amount,
          unit: flowCtx.unit,
          // Carry the pre-created quote (BTC-05) so Pay still executes
          // against the quote whose fee the user saw.
          ...(meltQuotePreviewMatches(flowCtx.meltQuotePreview, {
            mintUrl: flowCtx.mintUrl,
            meltTarget: flowCtx.meltTarget,
            amount: flowCtx.amount,
            unit: flowCtx.unit,
          })
            ? { meltQuote: flowCtx.meltQuotePreview }
            : {}),
        });
      } else if (flowCtx.paymentRequest) {
        setStep("navigateToPaymentRequest", {
          mintUrl: flowCtx.mintUrl,
          paymentRequest: flowCtx.paymentRequest,
          amount: flowCtx.amount,
          unit: flowCtx.unit,
        });
      }
      notify();
    } else if (
      step === "selectMint" &&
      (event.type === "CONFIRM_MELT" ||
        event.type === "CONFIRM_PAYMENT_REQUEST")
    ) {
      // The restore guard failed: the selector was dismissed with no mint
      // ever chosen, so the machine sits on selectMint while the UI shows
      // the terminal screen. Never drop the confirm tap silently (BTC-09):
      // surface "choose a mint" and re-dispatch the selector handler so the
      // flow can complete instead of dead-ending on an inert Pay button.
      logger.warn("machine.confirm.noMintSelected", { type: event.type });
      void notifications?.onMissingMintForAmount?.();
      try {
        await dispatchHandler(step, stepData);
      } finally {
        handlerExecuting = false;
        sendLocked = false;
        notify();
      }
      return;
    }

    if (
      event.type === "CONFIRM_MELT" &&
      step === "navigateToMeltPreview" &&
      operations?.executeMelt
    ) {
      const originalStep = step;
      const data = stepData as StepDataMap["navigateToMeltPreview"];
      logger.info("machine.confirmMelt.start", {
        ...mintUrlFields(data.mintUrl),
        amount: data.amount,
        meltTargetLength: data.meltTarget?.length ?? 0,
      });
      handlerExecuting = true;
      notify();

      void notifications?.onPaymentProcessing?.({
        variant: "melt",
        mintUrl: data.mintUrl,
        amount: data.amount,
        unit: data.unit,
        // The quote method lives on the flow context, not the step data —
        // lets the wallet gate the in-progress indicator per method.
        ...(flowCtx.meltQuoteMethod ? { method: flowCtx.meltQuoteMethod } : {}),
      });

      commitGeneration = sendGeneration;
      let effect: Awaited<ReturnType<typeof runConfirmMeltEffect>>;
      try {
        effect = await runConfirmMeltEffect({
          data,
          operation: operations.executeMelt,
          context: flowCtx,
          isStale: (op) => isStaleGeneration(sendGeneration, op),
        });
      } finally {
        if (commitGeneration === sendGeneration) commitGeneration = null;
      }

      if (effect.isOk()) {
        if (effect.value.kind === "stale") return;
        logger.info("machine.melt.success", { ...mintUrlFields(data.mintUrl) });

        for (const link of effect.value.links) {
          if (link.type === "linkTransaction") {
            operations.linkTransaction?.(link.input, link.transactionId);
          }
        }

        for (const notification of effect.value.notifications) {
          if (notification.type === "onPaymentConfirmed") {
            void notifications?.onPaymentConfirmed?.(notification.data);
          } else if (notification.type === "onTransactionCreated") {
            void notifications?.onTransactionCreated?.(notification.data);
          } else if (notification.type === "onMeltQuoteCreated") {
            void notifications?.onMeltQuoteCreated?.(notification.data);
          }
        }

        setStep(effect.value.step, effect.value.data);
      } else {
        logger.warn("machine.melt.failed", {
          error: errField(effect.error.cause),
        });
        routeOperationFailure(
          effect.error.cause,
          "melt",
          data.meltTarget,
          data,
        );
      }

      if (isStaleGeneration(sendGeneration, "executeMelt.finalize")) return;
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
        if (!isStaleGeneration(sendGeneration, "confirmMelt.unlock")) {
          sendLocked = false;
        }
      }
      return;
    }

    if (
      event.type === "CONFIRM_PAYMENT_REQUEST" &&
      step === "navigateToPaymentRequest" &&
      operations?.executePaymentRequest
    ) {
      const originalStep = step;
      const data = stepData as StepDataMap["navigateToPaymentRequest"];
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
      logger.info("machine.confirmPaymentRequest.start", {
        ...mintUrlFields(data.mintUrl),
        amount: data.amount,
        paymentRequestLength: data.paymentRequest.length,
      });
      handlerExecuting = true;
      notify();

      void notifications?.onPaymentProcessing?.({
        variant: "paymentRequest",
        mintUrl: data.mintUrl,
        amount: data.amount,
        unit: data.unit,
      });

      commitGeneration = sendGeneration;
      let effect: Awaited<ReturnType<typeof runConfirmPaymentRequestEffect>>;
      try {
        effect = await runConfirmPaymentRequestEffect({
          data,
          operation: operations.executePaymentRequest,
          context: flowCtx,
          isStale: (op) => isStaleGeneration(sendGeneration, op),
        });
      } finally {
        if (commitGeneration === sendGeneration) commitGeneration = null;
      }

      if (effect.isOk()) {
        if (effect.value.kind === "stale") return;

        if (effect.value.kind === "rolledBack") {
          // Delivery failed but ecash was reclaimed — route through standard
          // failure path so BIP321 multi-option flows show the fallback selector.
          logger.warn("machine.paymentRequest.rolledBack", {
            ...mintUrlFields(data.mintUrl),
            errorMessage: effect.value.errorMessage,
          });
          settle(true);
          routeOperationFailure(
            effect.value.cause,
            "paymentRequest",
            data.paymentRequest,
            data,
            { rolledBack: true },
          );
        } else {
          // Normal success path
          logger.info("machine.paymentRequest.success", {
            ...mintUrlFields(data.mintUrl),
          });
          settle(false);

          for (const link of effect.value.links) {
            if (link.type === "linkTransaction") {
              operations.linkTransaction?.(link.input, link.transactionId);
            }
          }

          for (const notification of effect.value.notifications) {
            if (notification.type === "onPaymentConfirmed") {
              void notifications?.onPaymentConfirmed?.(notification.data);
            } else if (notification.type === "onTransactionCreated") {
              void notifications?.onTransactionCreated?.(notification.data);
            }
          }

          setStep(effect.value.step, effect.value.data);
        }
      } else {
        logger.warn("machine.paymentRequest.failed", {
          error: errField(effect.error.cause),
        });
        settle(false);
        routeOperationFailure(
          effect.error.cause,
          "paymentRequest",
          data.paymentRequest,
          data,
        );
      }

      if (isStaleGeneration(sendGeneration, "executePaymentRequest.finalize"))
        return;
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
        if (
          !isStaleGeneration(sendGeneration, "confirmPaymentRequest.unlock")
        ) {
          sendLocked = false;
        }
      }
      return;
    }

    // Wrap the main transition path so sendLocked is always released,
    // even if transition() or an operation throws unexpectedly.
    try {
      let postDispatchTask: Promise<void> | null = null;
      const walletCtx = getContext();
      const unit = getUnit?.() ?? configUnit;

      // Resolve current offline status once per event. Passed into
      // transition() so every code path (EXECUTE, AMOUNT_ENTERED, etc.)
      // sees the real-time value from the provider.
      const offline = getOffline?.() ?? false;

      const eventForTransition =
        event.type === "AMOUNT_ENTERED"
          ? {
              ...event,
              offline: event.offline ?? offline,
            }
          : event;

      const reviewMintData =
        event.type === "MINT_TRUSTED" && step === "reviewMint"
          ? (stepData as StepDataMap["reviewMint"])
          : null;

      // Capture original options before transition overwrites stepData.
      const preTransitionOptions =
        event.type === "OPTION_CHOSEN" &&
        (step === "chooseOption" || step === "chooseFallbackOption")
          ? (stepData as StepDataMap["chooseOption"]).options
          : undefined;

      const prevStep = step;
      // Capture recipient-identity ctx snapshot *before* the transition so the
      // post-transition resolver only fires when something actually changed.
      const prevMeltTarget = flowCtx.meltTarget;
      const prevRecipientPubkey = flowCtx.recipientPubkey;
      const result = transition(
        step,
        flowCtx,
        eventForTransition,
        detectors,
        walletCtx,
        unit,
        offline,
        enableEcashSendMemo,
        getSatsPerUnitMinor,
      );

      flowCtx = result.context;
      setStep(result.step, result.data);
      if (step !== prevStep) {
        logger.info("machine.transition", {
          from: prevStep,
          to: step,
          eventType: event.type,
          flowSource: flowCtx.source,
          intentType: flowCtx.intent?.type,
          hasMintUrl: !!flowCtx.mintUrl,
          hasAmount: flowCtx.amount != null,
          unit: flowCtx.unit,
        });
      }

      // Kick off NIP-05 + kind-0 resolution as a background side effect when
      // meltTarget/recipientPubkey first appear on ctx. Best-effort: failure
      // returns null silently, so the flow never blocks on identity lookup.
      maybeResolveRecipient(prevMeltTarget, prevRecipientPubkey);

      // Save BIP321 original options for fallback (first selection only).
      if (preTransitionOptions && preTransitionOptions.length > 1) {
        flowCtx.originalOptions =
          flowCtx.originalOptions ?? preTransitionOptions;
      }

      // Clear the scan dedup guard once we leave option-selection (e.g. user
      // picked an option, flow errored, etc.). While selection is pending, only
      // the same camera payload is suppressed; a distinct scan is fresh intent.
      if (
        processedScanInput !== null &&
        step !== "chooseOption" &&
        step !== "chooseFallbackOption"
      ) {
        processedScanInput = null;
      }

      if (event.type === "EXECUTE") {
        const scanSource = lastScanSource;
        lastScanSource = undefined;
        flowCtx.source = scanSource;
        if (notifications?.onScanResolved && flowCtx.parsed) {
          const optionKinds =
            flowCtx.parsed.options.length > 0
              ? [...new Set(flowCtx.parsed.options.map((o) => o.kind))]
              : undefined;
          void notifications.onScanResolved({
            rawInput: event.input,
            parsedType: flowCtx.parsed.type ?? "unknown",
            intentType: flowCtx.intent?.type ?? "unknown",
            source: scanSource,
            container: flowCtx.parsed.container ?? undefined,
            optionKinds,
          });
        }
      }

      if (eventForTransition.type === "AMOUNT_ENTERED") {
        const e = eventForTransition;
        if (e.amount > 0 && !String(e.mintUrl ?? "").trim()) {
          void notifications?.onMissingMintForAmount?.();
        }
      }

      // Mint selection notifications: scope 'npc' → onNpcMintChanged;
      // 'bolt12'/'onchain' → onReceiveMethodMintChanged; else →
      // onPreferredMintChanged when applicable.
      if (event.type === "MINT_SELECTED") {
        if (event.scope === "npc") {
          void notifications?.onNpcMintChanged?.({ mintUrl: event.mintUrl });
        } else if (event.scope === "bolt12" || event.scope === "onchain") {
          void notifications?.onReceiveMethodMintChanged?.({
            method: event.scope,
            mintUrl: event.mintUrl,
          });
        } else {
          const isPersistOnlyPath = step === "dismiss" && !flowCtx.destination;
          const shouldPersist = event.persist ?? isPersistOnlyPath;
          if (shouldPersist) {
            void notifications?.onPreferredMintChanged?.({
              mintUrl: event.mintUrl,
            });
          }
        }
      }

      // NFC auto-resolve: when source is 'nfc' and an adapter is available,
      // automatically resolve interactive steps (option choice, mint selection)
      // and auto-execute payment request sends with NFC write-back.
      if (flowCtx.source === "nfc" && nfcAdapter) {
        let nfcResolved = false;

        // Loop because auto-resolving one step (e.g. chooseOption) may produce
        // another step (e.g. selectMint) that also needs auto-resolution.
        while (!nfcResolved) {
          if (step === "chooseOption" || step === "chooseFallbackOption") {
            const options = (stepData as StepDataMap["chooseOption"]).options;
            const best =
              options.find(
                (o) =>
                  o.option.kind === "paymentRequest" && o.status !== "disabled",
              ) ??
              options.find(
                (o) =>
                  o.option.kind === "lightningInvoice" &&
                  o.status !== "disabled",
              ) ??
              options.find((o) => o.status !== "disabled");
            if (best) {
              const walletCtxInner = getContext();
              const unitInner = getUnit?.() ?? configUnit;
              const r = transition(
                step,
                flowCtx,
                { type: "OPTION_CHOSEN", option: best.option },
                detectors,
                walletCtxInner,
                unitInner,
                offline,
                enableEcashSendMemo,
                getSatsPerUnitMinor,
              );
              flowCtx = r.context;
              flowCtx.source = "nfc";
              setStep(r.step, r.data);
              continue;
            }
            // No viable option
            nfcResolved = true;
          } else if (step === "selectMint") {
            const data = stepData as StepDataMap["selectMint"];
            const best = data.candidates[0];
            if (best) {
              void notifications?.onNfcPaymentProgress?.({
                phase: "selecting",
              });
              const walletCtxInner = getContext();
              const unitInner = getUnit?.() ?? configUnit;
              const r = transition(
                step,
                flowCtx,
                { type: "MINT_SELECTED", mintUrl: best.mintUrl },
                detectors,
                walletCtxInner,
                unitInner,
                offline,
                enableEcashSendMemo,
                getSatsPerUnitMinor,
              );
              flowCtx = r.context;
              flowCtx.source = "nfc";
              setStep(r.step, r.data);
              continue;
            }
            // No candidates — will be handled by error dispatch below
            nfcResolved = true;
          } else if (step === "enterAmount") {
            // NFC requires amount in payment request — if we reach enterAmount, the request lacked it
            await nfcAdapter.releaseSession();
            setStep("error", {
              code: "NFC_READ_FAILED",
              message: "Payment request must include an amount for NFC payment",
            });
            nfcResolved = true;
          } else if (
            step === "navigateToPaymentRequest" &&
            operations?.executeNfcSend
          ) {
            // Auto-execute: create token → write back to NFC tag
            const data = stepData as StepDataMap["navigateToPaymentRequest"];
            handlerExecuting = true;
            notify();

            commitGeneration = sendGeneration;
            let effect: Awaited<ReturnType<typeof runNfcWriteBackEffect>>;
            try {
              effect = await runNfcWriteBackEffect({
                data,
                executeNfcSend: operations.executeNfcSend,
                rollbackSend: operations.rollbackSend,
                nfcAdapter,
                context: flowCtx,
                onProgress: (progress) => {
                  void notifications?.onNfcPaymentProgress?.(progress);
                },
                isStale: (op) => isStaleGeneration(sendGeneration, op),
              });
            } finally {
              if (commitGeneration === sendGeneration) commitGeneration = null;
            }

            if (effect.isOk()) {
              if (effect.value.kind === "stale") return;

              for (const link of effect.value.links) {
                if (link.type === "linkTransaction") {
                  operations.linkTransaction?.(link.input, link.transactionId);
                }
              }

              for (const notification of effect.value.notifications) {
                if (notification.type === "onPaymentConfirmed") {
                  void notifications?.onPaymentConfirmed?.(notification.data);
                } else if (notification.type === "onTransactionCreated") {
                  void notifications?.onTransactionCreated?.(notification.data);
                }
              }

              setStep(effect.value.step, effect.value.data);
            } else {
              for (const notification of effect.error.notifications) {
                if (notification.type === "onNfcWriteFailed") {
                  void notifications?.onNfcWriteFailed?.(notification.data);
                }
              }

              setStep("error", effect.error.data);
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
        if (step === "confirmSend") {
          const data = stepData as StepDataMap["confirmSend"];
          const walletCtx = getContext();
          const proofAmounts = walletCtx.proofAmounts[data.mintUrl] ?? [];
          const localProofs = buildProofSuggestions(proofAmounts, data.amount);
          const hasExactLocalProofs =
            proofAmounts.length > 0 && localProofs.exactMatch;
          const shouldCreateLocalTokenFirst =
            hasExactLocalProofs && !!operations.executeOfflineSend;
          logger.info("machine.confirmSend.start", {
            ...mintUrlFields(data.mintUrl),
            amount: data.amount,
            hasExactLocalProofs,
            localFirst: shouldCreateLocalTokenFirst,
          });
          handlerExecuting = true;
          notify();
          commitGeneration = sendGeneration;
          let effect: Awaited<ReturnType<typeof runConfirmSendEffect>>;
          try {
            effect = await runConfirmSendEffect({
              data,
              operations,
              context: flowCtx,
              proofAmounts,
              getOffline: () => getOffline?.() ?? false,
              getLocale: () => getLocale?.() ?? "en",
              isStale: (op) => isStaleGeneration(sendGeneration, op),
            });
          } finally {
            if (commitGeneration === sendGeneration) commitGeneration = null;
          }

          if (effect.isOk()) {
            if (effect.value.kind === "stale") return;
            if (effect.value.context) {
              flowCtx = { ...flowCtx, ...effect.value.context };
            }

            if (effect.value.kind === "completed") {
              if (effect.value.path === "localFirst") {
                logger.info("machine.send.localFirst.success");
              } else if (effect.value.path === "offlineFallback") {
                logger.info("machine.send.offlineFallback.success");
              } else {
                logger.info("machine.send.success");
              }
              setStep(effect.value.step, effect.value.data);

              for (const notification of effect.value.notifications) {
                if (notification.type === "onTransactionCreated") {
                  void notifications?.onTransactionCreated?.(notification.data);
                }
              }
            } else {
              setStep(effect.value.step, effect.value.data);
            }
          } else {
            if (effect.error.context) {
              flowCtx = { ...flowCtx, ...effect.error.context };
            }
            if (effect.error.fallbackFailure) {
              logger.warn("machine.send.offlineFallback.failed", {
                error: errField(effect.error.fallbackFailure),
              });
            }
            setStep("error", effect.error.data);
          }
          handlerExecuting = false;
          notify();
        } else if (step === "createMintQuote") {
          const data = stepData as StepDataMap["createMintQuote"];
          logger.info("machine.createMintQuote.start", {
            ...mintUrlFields(data.mintUrl),
            amount: data.amount,
            method: data.method ?? "bolt11",
          });
          handlerExecuting = true;
          notify();
          // NOTE: deliberately NOT enrolled in the commit generation — the
          // back-nav resubmit flow (INTENT_EVENTS supersede) is the designed
          // behavior for quote creation (see back-nav-reentry tests): the
          // stale continuation is discarded via isStaleGeneration, and the
          // superseded quote simply expires at the mint. coco exposes no
          // mint-quote cancel, so a hard commit would only break re-entry.
          const effect = await runMintQuoteEffect({
            data,
            operations,
            context: flowCtx,
            getOffline: () => getOffline?.() ?? false,
            getLocale: () => getLocale?.() ?? "en",
            isStale: (op) => isStaleGeneration(sendGeneration, op),
          });

          if (effect.isOk()) {
            if (effect.value.kind === "stale") return;
            logger.info("machine.createMintQuote.success");
            setStep(effect.value.step, effect.value.data);

            for (const notification of effect.value.notifications) {
              if (notification.type === "onTransactionCreated") {
                void notifications?.onTransactionCreated?.(notification.data);
              }
            }
          } else {
            logger.warn("machine.createMintQuote.failed", {
              error: errField(effect.error.cause),
            });
            setStep("error", effect.error.data);
          }
          handlerExecuting = false;
          notify();
        } else if (step === "createPaymentRequestReceive") {
          const data = stepData as StepDataMap["createPaymentRequestReceive"];
          logger.info("machine.createPaymentRequestReceive.start", {
            amount: data.amount,
            unit: data.unit,
          });
          handlerExecuting = true;
          notify();
          // Deliberately NOT commit-generation enrolled — same rationale as
          // createMintQuote above (supersede-on-resubmit is designed).
          const effect = await runPaymentRequestReceiveEffect({
            data,
            operations,
            isStale: (op) => isStaleGeneration(sendGeneration, op),
          });

          if (effect.isOk()) {
            if (effect.value.kind === "stale") return;
            logger.info("machine.createPaymentRequestReceive.success");
            setStep(effect.value.step, effect.value.data);
          } else {
            logger.warn("machine.createPaymentRequestReceive.failed", {
              error: errField(effect.error.cause),
            });
            setStep("error", effect.error.data);
          }
          handlerExecuting = false;
          notify();
        } else if (step === "selectMint") {
          const data = stepData as StepDataMap["selectMint"];
          if (!data.mintListItems) {
            setStep("selectMint", {
              ...data,
              mintListItems: buildFallbackMintListItems(data),
              mintListItemsStatus: "loading",
            });
            postDispatchTask = startMintListEnrichment(data, sendGeneration);
            notify();
          }
        }
      }

      // Review mint / open mint: load detailed mint info before dispatching the handler.
      if (
        (step === "reviewMint" || step === "openMint") &&
        operations?.buildMintReviewInfo
      ) {
        const reviewStep = step;
        const reviewData =
          reviewStep === "reviewMint"
            ? (stepData as StepDataMap["reviewMint"])
            : (stepData as StepDataMap["openMint"]);
        handlerExecuting = true;
        notify();

        const effect = await runMintReviewInfoEffect({
          step: reviewStep,
          data: reviewData,
          operation: operations.buildMintReviewInfo,
          getLocale: () => getLocale?.() ?? "en",
          isStale: (op) => isStaleGeneration(sendGeneration, op),
        });

        if (effect.isOk()) {
          if (effect.value.kind === "stale") return;
          if (effect.value.step === "reviewMint") {
            setStep("reviewMint", effect.value.data);
          } else {
            setStep("openMint", effect.value.data);
          }
        } else {
          setStep("error", effect.error.data);
        }
        handlerExecuting = false;
        notify();
      }

      // Trust mint operation: when MINT_TRUSTED transitions to receiveToken,
      // call operations.trustMint first. On failure, redirect to error.
      if (reviewMintData && operations?.trustMint && step === "receiveToken") {        handlerExecuting = true;
        notify();

        const effect = await runTrustMintEffect({
          data: reviewMintData,
          operation: operations.trustMint,
          getLocale: () => getLocale?.() ?? "en",
          isStale: (op) => isStaleGeneration(sendGeneration, op),
        });

        if (effect.isOk()) {
          if (effect.value.kind === "stale") return;
        } else {
          setStep("error", effect.error.data);
        }
        handlerExecuting = false;
        notify();
      }

      // Quote-first melt preview (BTC-05): create the melt quote BEFORE the
      // preview screen renders so the confirm sheet can show the mint's real
      // fee_reserve and the amount+fee total. Pay executes against THIS
      // quote, so the displayed fee is the charged fee. Best-effort: when
      // quote creation fails the preview navigates without one and Pay
      // falls back to creating a quote at execution. Onchain targets keep
      // their at-execution fee picker (NUT-30 fee options).
      if (
        step === "navigateToMeltPreview" &&
        operations?.quoteMelt &&
        meltMethodForTarget(
          (stepData as StepDataMap["navigateToMeltPreview"]).meltTarget,
        ) !== "onchain"
      ) {
        const data = stepData as StepDataMap["navigateToMeltPreview"];
        const matching = meltQuotePreviewMatches(
          flowCtx.meltQuotePreview,
          data,
        )
          ? flowCtx.meltQuotePreview
          : undefined;
        if (matching) {
          if (!data.meltQuote) {
            setStep("navigateToMeltPreview", { ...data, meltQuote: matching });
          }
        } else {
          handlerExecuting = true;
          notify();
          const effect = await runMeltQuotePreviewEffect({
            data,
            operation: operations.quoteMelt,
            isStale: (op) => isStaleGeneration(sendGeneration, op),
          });
          if (effect.isOk()) {
            if (effect.value.kind === "stale") return;
            flowCtx = { ...flowCtx, meltQuotePreview: effect.value.quote };
            setStep("navigateToMeltPreview", {
              ...data,
              meltQuote: effect.value.quote,
            });
          } else {
            // Degrade to pay-then-quote (pre-quote-first shape) — never
            // block the preview on a quote failure.
            if (flowCtx.meltQuotePreview) {
              flowCtx = { ...flowCtx, meltQuotePreview: undefined };
            }
            logger.warn("machine.meltQuotePreview.unavailable", {
              error: errField(effect.error.cause),
            });
          }
          handlerExecuting = false;
          notify();
        }
      }

      // Dispatch notification for error steps (fire-and-forget).
      if (step === "error" && notifications) {
        const errorData = stepData as StepDataMap["error"];
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
        if (isStaleGeneration(sendGeneration, "dispatchHandler")) return;
        if (postDispatchTask) {
          // Preserve the existing selectMint timing: handlers receive fallback
          // rows first, then immediately-settled enrichment can land before the
          // machine action promise resolves.
          await Promise.race([
            postDispatchTask,
            new Promise<void>((resolve) => setTimeout(resolve, 0)),
          ]);
          if (isStaleGeneration(sendGeneration, "dispatchHandler.postTask"))
            return;
        }
      } finally {
        if (isStaleGeneration(sendGeneration, "dispatchHandler.finally"))
          return;
        if (trackExecuting) {
          handlerExecuting = false;
        }
        sendLocked = false;
        notify();
      }
    } catch (err) {
      // Safety net: release sendLocked so the machine doesn't permanently lock
      // if transition() or an operation throws before the inner finally runs.
      if (isStaleGeneration(sendGeneration, "machine.transition.safetyNet"))
        return;
      logger.warn("machine.transition.safetyNet", { error: errField(err) });
      sendLocked = false;
      handlerExecuting = false;
      notify();
    }
  };

  const changeMint = (
    mintUrl: string,
    opts?: { persist?: boolean; scope?: MintSelectorScope },
  ) => {
    return send({
      type: "MINT_SELECTED",
      mintUrl,
      persist: opts?.persist,
      scope: opts?.scope,
    });
  };

  const requestMintSelector = (opts?: {
    reset?: boolean;
    scope?: MintSelectorScope;
  }) => {
    if (opts?.reset) resetInternal();
    return send({ type: "REQUEST_MINT_SELECTOR", scope: opts?.scope });
  };

  const execute = (input: string, opts?: { reset?: boolean }) => {
    if (opts?.reset) resetInternal();
    return send({ type: "EXECUTE", input });
  };

  async function processScanData(data: string): Promise<ProcessResult> {
    const isUR = data.startsWith("ur:") || data.startsWith("UR:");
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

    if (processedScanInput === data) {
      return { urInProgress: false };
    }

    processedScanInput = data;
    await execute(data);
    const state = cachedSnapshot;

    if (
      state.status !== "needsInput" ||
      state.code !== "OPTION_SELECTION_REQUIRED"
    ) {
      processedScanInput = null;
    }

    return {
      urInProgress: false,
      lockedPending:
        state.status === "needsInput" &&
        state.code === "OPTION_SELECTION_REQUIRED",
    };
  }

  const scan =
    createURDecoder || scanSources
      ? async (
          data?: string,
          options?: ScanOptions,
        ): Promise<ProcessResult> => {
          if (options?.reset) resetInternal();

          const hasData = data != null && data.length > 0;
          lastScanSource =
            options?.source ?? (hasData ? undefined : "clipboard");

          if (hasData) {
            return processScanData(data);
          }

          const source = options?.source ?? "clipboard";
          const sourceFn =
            source === "clipboard"
              ? scanSources?.clipboard
              : source === "gallery"
                ? scanSources?.gallery
                : source === "nfc"
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
              err instanceof Error ? err : new Error(String(err)),
            );
            return { urInProgress: false };
          }

          if ("canceled" in result && result.canceled) {
            return { urInProgress: false };
          }
          if ("empty" in result && result.empty) {
            void notifications?.onScanEmpty?.(source);
            return { urInProgress: false };
          }
          if ("error" in result && result.error) {
            void notifications?.onScanError?.(source, result.error);
            return { urInProgress: false };
          }
          if ("data" in result && result.data) {
            return processScanData(result.data);
          }

          return { urInProgress: false };
        }
      : undefined;

  const enterAmount = (
    amount: UnitAmount,
    mintUrl: string,
    opts?: {
      destination?: Destination;
      mintQuoteMethod?: MintQuoteMethod;
      meltQuoteMethod?: MeltQuoteMethod;
      offline?: boolean;
      meltTarget?: string;
      recipientPubkey?: string;
      recipientProfile?: RecipientProfile;
      amountEntryDisplay?: AmountEntryDisplayMetadata;
    },
  ) =>
    send({
      type: "AMOUNT_ENTERED",
      amount: amount.value,
      unit: amount.unit,
      mintUrl,
      destination: opts?.destination,
      mintQuoteMethod: opts?.mintQuoteMethod,
      meltQuoteMethod: opts?.meltQuoteMethod,
      offline: opts?.offline,
      meltTarget: opts?.meltTarget,
      recipientPubkey: opts?.recipientPubkey,
      recipientProfile: opts?.recipientProfile,
      amountEntryDisplay: opts?.amountEntryDisplay,
    });

  const chooseOption = (option: PaymentOption) =>
    send({ type: "OPTION_CHOSEN", option });

  const chooseProofs = (amount: number) =>
    send({ type: "PROOFS_CHOSEN", amount });

  const submitSendMemo = (memo?: string) =>
    send({ type: "SEND_MEMO_SUBMITTED", memo });

  const startSend = (opts?: { reset?: boolean }) => {
    if (opts?.reset) resetInternal();
    return send({ type: "START_SEND" });
  };

  const startSendEcash = (opts?: {
    reset?: boolean;
    meltTarget?: string;
    recipientPubkey?: string;
    recipientProfile?: RecipientProfile;
    p2pkLockPubkey?: string;
    allowedMints?: string[];
    entrySource?: SendEntrySource;
  }) => {
    if (opts?.reset) resetInternal();
    return send({
      type: "START_SEND_ECASH",
      ...(opts?.meltTarget ? { meltTarget: opts.meltTarget } : {}),
      ...(opts?.recipientPubkey
        ? { recipientPubkey: opts.recipientPubkey }
        : {}),
      ...(opts?.recipientProfile
        ? { recipientProfile: opts.recipientProfile }
        : {}),
      ...(opts?.p2pkLockPubkey ? { p2pkLockPubkey: opts.p2pkLockPubkey } : {}),
      ...(opts?.allowedMints ? { allowedMints: opts.allowedMints } : {}),
      ...(opts?.entrySource ? { entrySource: opts.entrySource } : {}),
    });
  };

  const startReceiveLightning = (opts?: { reset?: boolean }) => {
    if (opts?.reset) resetInternal();
    return send({ type: "START_RECEIVE_LIGHTNING" });
  };
  const startReceive = (opts?: { reset?: boolean }) => {
    if (opts?.reset) resetInternal();
    return send({ type: "START_RECEIVE" });
  };
  const showReceiveQr = (opts?: { reset?: boolean }) => {
    if (opts?.reset) resetInternal();
    return send({ type: "SHOW_RECEIVE_QR" });
  };

  const reviewMint = (mintUrl: string, token: string) =>
    send({ type: "REVIEW_MINT", mintUrl, token });

  const mintTrusted = () => send({ type: "MINT_TRUSTED" });

  const confirmMelt = () => send({ type: "CONFIRM_MELT" });
  const confirmPaymentRequest = async (): Promise<{ rolledBack: boolean }> => {
    // Per-call holder isolates this caller's result from any concurrent
    // confirmPaymentRequest the lock blocks. The handler writes only to
    // holders it snapshotted before its await, so a locked-out caller's
    // holder retains its default `{ rolledBack: false }`.
    const holder: { rolledBack: boolean } = { rolledBack: false };
    pendingPaymentRequestConfirms.push(holder);
    try {
      await send({ type: "CONFIRM_PAYMENT_REQUEST" });
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
    submitSendMemo,
    changeMint,
    requestMintSelector,
    startSend,
    startSendEcash,
    startReceiveLightning,
    startReceive,
    showReceiveQr,
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
