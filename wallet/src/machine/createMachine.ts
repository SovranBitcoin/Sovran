import { ResultAsync } from "neverthrow";
import { parsePaymentInput } from "../parse";
import { rankMintCandidates } from "../mint-selection";
import { isValidSatAmount } from "../guards";
import { defaultDetectors } from "../detectors";
import type { P2pkLockSpec } from "../p2pk";
import { createMintRowRules } from "../mint-list-rows";
import {
  failureText,
  isMeltUserCancelledError,
  isMintOfflineError,
  PaymentRequestUndeliveredError,
} from "../errors";
import { isLockedSend } from "../p2pk";
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
} from "./effects";
import type { MachineEffectLink, MachineEffectNotification } from "./effects";
import { previewStep } from "./resolveNext";
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
  FlowEvent,
  FlowStep,
  SendFallbackId,
  MeltQuoteMethod,
  MintQuoteMethod,
  MintSelectorScope,
  NfcIOAdapter,
  PaymentMachine,
  PaymentRequestConfirmOutcome,
  PaymentRequestPreviewPhase,
  ProcessResult,
  RecipientProfile,
  ScanOptions,
  ScanSourceResult,
  SendEntrySource,
  StepDataMap,
} from "./types";

/**
 * Whether a payment preview still waits for Pay. Once it settled, or its
 * ecash left without being taken back, paying again (or choosing another
 * mint to pay from) could pay twice.
 */
function awaitsPay(phase: PaymentRequestPreviewPhase): boolean {
  switch (phase.kind) {
    case "preview":
      return true;
    case "settled":
    case "undelivered":
      return false;
    default: {
      const unreachable: never = phase;
      return unreachable;
    }
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
  "chooseSendFallback",
  "chooseProofs",
  "enterSendMemo",
]);

/**
 * What `inspect()` reports for a step: the step, and its data when the step
 * waits for input or is `error` (then `StepDataMap["error"]`).
 */
function deriveExecutionState(
  step: FlowStep,
  data: StepDataMap[FlowStep],
): ExecutionState {
  return INPUT_STEPS.has(step) || step === "error"
    ? { step, isExecuting: false, details: data as Record<string, unknown> }
    : { step, isExecuting: false };
}

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
const INTENT_EVENTS = new Set<FlowEvent["type"]>([
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
  "RESET",
]);

/**
 * Whether an event may leave a settled payment: a preview paid, delivered, or
 * sent and not taken back, or an ecash send that made its token
 * (`sendComplete`). Those that start another flow may. Any other event would
 * carry on the settled flow: re-resolve its amount or mint, re-choose its
 * option, reopen its mint list or Pay again, each rebuilding a preview that
 * Pay sends a second time, or a send that makes a second token. On a settled
 * payment they change nothing.
 */
const LEAVES_SETTLED_PAYMENT: Record<FlowEvent["type"], boolean> = {
  EXECUTE: true,
  RESET: true,
  START_SEND: true,
  START_SEND_ECASH: true,
  START_RECEIVE_LIGHTNING: true,
  START_RECEIVE: true,
  SHOW_RECEIVE_QR: true,
  // Redeeming a token from an untrusted mint, from a chat or the history,
  // while the machine still sits on the last payment.
  REVIEW_MINT: true,
  OPTION_CHOSEN: false,
  AMOUNT_ENTERED: false,
  MINT_SELECTED: false,
  PROOFS_CHOSEN: false,
  SEND_MEMO_SUBMITTED: false,
  REQUEST_MINT_SELECTOR: false,
  CONFIRM_MELT: false,
  CONFIRM_PAYMENT_REQUEST: false,
};

/**
 * What an NFC tap holds from the read that started it until it ends: the tag
 * session the read left open, and the unit it switched the host to for the
 * terminal. One EXECUTE turn opens it and ends it in one place (`endNfcTap`),
 * which every way out reaches. A tap a reset or a newer turn overtook ends
 * there too: it lets go of the tag and the unit while they are still its own,
 * and touches nothing else.
 */
interface NfcTap {
  /** What the tag said. */
  input: string;
  adapter: NfcIOAdapter;
  /** The NFC read that started it (see `nfcRead`). */
  read: number;
  /** The write-back releases the session itself; otherwise the tap's end does. */
  session: "held" | "released";
  /** The unit the host now shows, and how to switch back to the user's. */
  unitSwitch: { unit: string; restore: () => Promise<void> } | null;
}

/**
 * Where an EXECUTE came from, fixed when its scan began: the scan source, and
 * for an NFC read which read it was (see `nfcRead`). It travels with the
 * scanned input, so a read that finishes after a newer one began, or that the
 * machine did not take, is never stamped with another scan's identity.
 */
interface ScanOrigin {
  source: string | undefined;
  nfc: NfcReadHandover | null;
}

/**
 * An NFC read handed to the machine with its tag session. A tap that takes
 * it ends the session (`endNfcTap`); a read no tap took (its turn was
 * dropped while money moved, or the input was not run) is let go by the scan
 * that read it.
 */
interface NfcReadHandover {
  read: number;
  taken: "no" | "tap" | "dropped";
}

/**
 * How a tap's loop left. A paid tap (its token is on the tag) keeps the
 * terminal's unit; a stopped one switches back, then shows `error` when it has
 * one; one that threw switches back, then throws on. An overtaken tap ends as
 * paid or stopped and shows and throws nothing.
 */
type NfcTapEnd =
  | { kind: "paid" }
  | { kind: "stopped"; error?: StepDataMap["error"] }
  | { kind: "threw"; error: unknown };

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
  const currentUnit = () => getUnit?.() ?? configUnit;
  const currentLocale = () => getLocale?.() ?? "en";
  const currentOffline = () => getOffline?.() ?? false;

  let urDecoder: ReturnType<NonNullable<typeof createURDecoder>> | null =
    createURDecoder?.() ?? null;
  let processedScanInput: string | null = null;
  // The tag session and the unit belong to one NFC tap at a time, and the
  // adapter cannot tell one session from the next. `nfcRead` counts the NFC
  // reads begun: each takes the session over from any before it, so only a
  // tap whose read is still the latest releases it. `latestNfcTap` is the last
  // tap the machine ran: only it switches the unit back, which a newer tap
  // may have switched and now decides for.
  let nfcRead = 0;
  let latestNfcTap: NfcTap | null = null;

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
  // Whether the open mint list was opened over a preview, which then still
  // awaited Pay (a settled preview is final). Pay with the list dismissed
  // restores that preview, and only that one. Opening the list again while
  // it is open keeps it. Cleared whenever the step leaves selectMint.
  let mintListOverPreview = false;
  // Counts the mint lists begun loading. Each open list begins one, so only
  // the latest belongs to the list now open: a flow's generation outlives a
  // picker, and an earlier picker's list can finish loading under a later one.
  let mintListLoad = 0;
  // The turn: one `send()` call holds the machine from `beginTurn` to
  // `finishTurn`. Only the functions under "Turn" below write these five.
  //
  // `flowGeneration` names the running turn and every async result of its
  // flow. A reset or a superseding event bumps it, so each continuation of
  // the older turn finds itself stale at its next check and returns: it owns
  // nothing any more, and must not free the newer turn's lock.
  let flowGeneration = 0;
  let sendLocked = false;
  // `inspect().isExecuting`: a step's work or its handler is running.
  let handlerExecuting = false;
  // Generation whose irreversible operation is executing (send, melt,
  // payment-request delivery, NFC write-back): every event is dropped, fresh
  // intent included, while it is the current generation.
  let commitGeneration: number | null = null;
  // Result holders of `confirmPaymentRequest` calls no turn has taken yet.
  // A call registers before `send`, and its turn takes it as it begins, so
  // only that turn's own send settles it; a caller the lock drops keeps its
  // `ignored`.
  let pendingPaymentRequestConfirms: {
    outcome: PaymentRequestConfirmOutcome;
  }[] = [];
  const listeners = new Set<() => void>();

  function setStep<S extends FlowStep>(
    nextStep: S,
    data: StepDataMap[S],
  ): void {
    step = nextStep;
    stepData = data as StepDataMap[FlowStep];
    if (nextStep !== "selectMint") mintListOverPreview = false;
  }

  let cachedSnapshot: ExecutionState = deriveExecutionState("idle", idleData);

  function resetInternal() {
    abandonTurn(() => {
      flowCtx = { unit: currentUnit() };
      setStep("idle", {});
    });
    processedScanInput = null;
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
    cachedSnapshot = {
      ...deriveExecutionState(step, stepData),
      isExecuting: handlerExecuting,
    };
    listeners.forEach((fn) => fn());
  };

  // ───────────────────────────────────────────────────────────────────────
  // Turn
  // ───────────────────────────────────────────────────────────────────────

  /**
   * The one way into a turn. Returns its generation, or null when the event
   * is dropped: money is moving, or another turn holds the machine and the
   * event carries no fresh intent. Fresh intent during a resolve supersedes
   * the running turn and takes its lock.
   */
  function beginTurn(type: FlowEvent["type"]): number | null {
    if (sendLocked) {
      const commitInFlight = commitGeneration === flowGeneration;
      if (commitInFlight || !INTENT_EVENTS.has(type)) {
        logger.info("machine.event.ignored", {
          reason: commitInFlight ? "commit-in-flight" : "locked",
          type,
        });
        return null;
      }
      flowGeneration += 1;
      setExecuting(false, false);
      logger.info("machine.event.superseded", { type, currentStep: step });
    }
    sendLocked = true;
    return flowGeneration;
  }

  /**
   * The one way out of a turn. Returns false, doing nothing, when a reset or
   * a superseding event took the machine from it. The turn stops executing
   * and tells listeners, unless `notify: false`.
   */
  function finishTurn(
    generation: number,
    op: string,
    exit: { notify?: false } = {},
  ): boolean {
    if (isStaleGeneration(generation, op)) return false;
    setExecuting(false, false);
    sendLocked = false;
    if (exit.notify !== false) notify();
    return true;
  }

  /** Frees the machine and leaves `inspect()` and its listeners alone. */
  const QUIET_EXIT = { notify: false } as const;

  /**
   * A reset: strands the running turn, restarts the flow, then frees the
   * machine. The machine stays held while `restartFlow` runs, so an event it
   * sends is dropped, and if it throws the machine is not freed.
   */
  function abandonTurn(restartFlow: () => void): void {
    flowGeneration += 1;
    restartFlow();
    finishTurn(flowGeneration, "reset", { notify: false });
    pendingPaymentRequestConfirms = [];
  }

  function setExecuting(value: boolean, announce = true): void {
    handlerExecuting = value;
    if (announce) notify();
  }

  /**
   * Says a melt or payment request is starting. A listener that throws stops
   * it before it starts: the turn finishes, then the throw goes on.
   */
  function announcePaymentStart(generation: number, op: string): void {
    try {
      setExecuting(true);
    } catch (err) {
      finishTurn(generation, op);
      throw err;
    }
  }

  function beginCommit(generation: number): void {
    commitGeneration = generation;
  }

  /** A reset may hand a newer turn the commit first; only its owner clears it. */
  function endCommit(generation: number): void {
    if (commitGeneration === generation) commitGeneration = null;
  }

  type ConfirmHolder = (typeof pendingPaymentRequestConfirms)[number];

  function registerConfirm(): ConfirmHolder {
    const holder: ConfirmHolder = { outcome: { kind: "ignored" } };
    pendingPaymentRequestConfirms.push(holder);
    return holder;
  }

  function unregisterConfirm(holder: ConfirmHolder): void {
    const idx = pendingPaymentRequestConfirms.indexOf(holder);
    if (idx >= 0) pendingPaymentRequestConfirms.splice(idx, 1);
  }

  /** Takes every registered confirm holder; returns how to settle them. */
  function takeConfirms(): (outcome: PaymentRequestConfirmOutcome) => void {
    const holders = pendingPaymentRequestConfirms;
    pendingPaymentRequestConfirms = [];
    return (outcome) => {
      for (const h of holders) h.outcome = outcome;
    };
  }

  /**
   * Calls one of the host's notifications. Every notification goes through
   * here. They are fire and forget: a throw, at once or from the promise it
   * returns, is logged and changes nothing about the payment, the turn, the
   * next step's handler or the caller's outcome.
   */
  function tell(name: string, call: () => unknown): void {
    const failed = (err: unknown) => {
      logger.warn("machine.notification.failed", { name, error: errField(err) });
    };
    try {
      Promise.resolve(call()).catch(failed);
    } catch (err) {
      failed(err);
    }
  }

  /**
   * Links a settled payment to its scan and tells the wallet about it. The
   * payment happened and its step already says so: a link or notification
   * that throws is logged, and neither undoes the payment nor keeps the turn
   * from finishing.
   */
  function announcePayment(news: {
    links: MachineEffectLink[];
    notifications: MachineEffectNotification[];
  }): void {
    for (const link of news.links) {
      tell("linkTransaction", () =>
        operations?.linkTransaction?.({
          scannedInput: link.input,
          transactionId: link.transactionId,
        }),
      );
    }
    for (const notification of news.notifications) {
      tell(notification.type, () => {
        switch (notification.type) {
          case "onPaymentConfirmed":
            return notifications?.onPaymentConfirmed?.(notification.data);
          case "onTransactionCreated":
            return notifications?.onTransactionCreated?.(notification.data);
          case "onMeltQuoteCreated":
            return notifications?.onMeltQuoteCreated?.(notification.data);
          case "onNfcWriteFailed":
            return notifications?.onNfcWriteFailed?.(notification.data);
          default: {
            const unreachable: never = notification;
            return unreachable;
          }
        }
      });
    }
  }

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

  /**
   * The retry behind a `chooseSendFallback` step, kept off the step data so
   * the app renders only what the user chooses between.
   */
  let sendFallback: {
    amount: number;
    unit: string;
    mintUrl: string;
    npcTarget?: string;
    error: StepDataMap["error"];
  } | null = null;

  /** Plain ecash for a lock the user added themselves; never for a required one. */
  function lockFallbackFor(
    data: { mintUrl: string; amount: number; unit: string },
    error: StepDataMap["error"],
  ): StepDataMap["chooseSendFallback"] | null {
    if (
      flowCtx.destination !== "sendEcash" ||
      !isLockedSend(flowCtx) ||
      !flowCtx.lockIsOptional
    ) {
      return null;
    }
    sendFallback = { ...data, error };
    return {
      amount: data.amount,
      unit: data.unit,
      failed: {
        label: "as Locked Ecash",
        message: error.message,
        authored: error.data?.authored === true,
      },
      alternatives: [
        {
          id: "ecash",
          label: "as Ecash",
          description:
            "Send it unlocked. Anyone holding the token can claim it, so share it only with them.",
        },
      ],
    };
  }

  /**
   * Their npub.cash address when their own Lightning address failed. Not when
   * the mint was the problem: npub.cash needs the same mint to pay.
   */
  function npcFallbackFor(
    err: unknown,
    data: { mintUrl: string; amount: number; unit: string; meltTarget?: string },
  ): StepDataMap["chooseSendFallback"] | null {
    const target = data.meltTarget ?? flowCtx.meltTarget ?? "";
    if (
      isMintOfflineError(err) ||
      !flowCtx.recipientPubkey ||
      !target.includes("@") ||
      /@npubx?\.cash$/i.test(target.trim()) ||
      meltMethodForTarget(target) === "onchain"
    ) {
      return null;
    }
    const npcTarget = operations?.npcAddressForPubkey?.(flowCtx.recipientPubkey);
    if (!npcTarget) return null;
    const { message, authored } = failureText(err, "Lightning payment failed");
    sendFallback = {
      amount: data.amount,
      unit: data.unit,
      mintUrl: data.mintUrl,
      npcTarget,
      error: {
        code: "MELT_FAILED",
        message,
        ...(authored ? { data: { authored: true } } : {}),
      },
    };
    return {
      amount: data.amount,
      unit: data.unit,
      failed: { label: `as Lightning (${target.trim()})`, message, authored },
      alternatives: [
        {
          id: "lightning-npc",
          label: "as Lightning (npub.cash)",
          description:
            "They haven't published this address. npub.cash accepts payments for any Nostr key, but only they can claim it, so check they use it.",
          isCaution: true,
        },
      ],
    };
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
    opts?: { rolledBack?: boolean; undelivered?: boolean },
  ): void {
    // A deliberate user cancel (e.g. dismissed fee sheet, nothing reserved)
    // dismisses the processing indicator quietly — no failure toast, and the
    // user stays on the preview step to retry or back out.
    if (isMeltUserCancelledError(err)) {
      logger.info("machine.operationFailure.userCancelled", { variant });
      tell("onPaymentCancelled", () =>
        notifications?.onPaymentCancelled?.({
          variant,
          mintUrl: data.mintUrl,
          amount: data.amount,
          unit: data.unit,
        }),
      );
      return;
    }

    const { message, authored } = isMintOfflineError(err)
      ? { message: t("MINT_UNREACHABLE", currentLocale()), authored: true }
      : failureText(
          err,
          `${variant === "melt" ? "Melt" : "Payment request"} failed`,
        );

    // Always notify failure so the processing notification is dismissed.
    tell("onPaymentFailed", () =>
      notifications?.onPaymentFailed?.({
        variant,
        mintUrl: data.mintUrl,
        amount: data.amount,
        unit: data.unit,
        message,
        authored,
        rolledBack: opts?.rolledBack,
      }),
    );

    // The ecash left the wallet and could not be taken back, so the recipient
    // may already hold it. Offering another option could pay them twice.
    if (opts?.undelivered) return;

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
          lastFailedAuthored: authored,
        });
        return;
      }

      setStep("error", {
        code: "ALL_OPTIONS_DISABLED",
        message: "All payment options have failed",
      });
      return;
    }

    if (variant === "melt") {
      const fallback = npcFallbackFor(err, { ...data, meltTarget: failedValue });
      if (fallback) {
        logger.info("machine.sendFallback.offered", { failed: "lightning", id: "lightning-npc" });
        setStep("chooseSendFallback", fallback);
        return;
      }
    }

    // Single-option: stay on the current step so the user can retry.
    // Step is NOT changed — the Pay/Confirm button becomes active again.
  }

  function buildFallbackMintListItems(
    data: StepDataMap["selectMint"],
  ): MintListItem[] {
    const walletCtx = getContext();
    const balanceByCandidate = new Map(
      data.candidates.map((candidate) => [candidate.mintUrl, candidate.balance]),
    );
    // The same MINTS and the same VERDICTS the enrichment will give. Every
    // trusted mint is listed (`data.candidates` is only what the flow may
    // pick), and each row's status and reason come from the rules the
    // enrichment uses, read against the wallet context instead of freshly
    // fetched mint info. Guessing here (an unfunded mint "has no balance", even
    // on a receive) made every row change a moment after the picker opened.
    const rowVerdict = createMintRowRules({
      data,
      capabilityCtx: walletCtx,
      crossesAccounts: (mintUrl) =>
        walletCtx.mintMethodCapabilities?.[mintUrl]?.outsideAccount === true,
      supportsWebsocket: (mintUrl) =>
        walletCtx.mintMethodCapabilities?.[mintUrl]?.nut17,
    });
    // Sorted with the SAME comparator the async enrichment uses, so the
    // first painted frame is already in the final order and the enriched
    // rows land without re-shuffling the list.
    const items = walletCtx.trustedMintUrls
      .map((mintUrl): MintListItem => {
        const balance =
          balanceByCandidate.get(mintUrl) ?? walletCtx.mintBalances[mintUrl] ?? 0;
        return {
          mintUrl,
          displayName: mintUrl,
          balance,
          unit: data.unit,
          ...rowVerdict(mintUrl, balance),
          isPreferred: false,
        };
      })
      .sort(compareMintDisplayOrder);
    logger.debug("machine.selectMint.fallbackItems", {
      candidateCount: data.candidates.length,
      itemCount: items.length,
      scope: data.scope ?? null,
    });
    return items;
  }

  function startMintListEnrichment(
    data: StepDataMap["selectMint"],
    generation: number,
  ): Promise<void> | null {
    if (!operations?.buildMintListItems) return null;
    const load = ++mintListLoad;

    const task = (async () => {
      const effect = await runMintListEnrichmentEffect({
        data,
        operation: operations.buildMintListItems,
        isStale: (op) => isStaleGeneration(generation, op),
      });
      if (load !== mintListLoad) {
        logger.info("machine.selectMint.enrichment.superseded", {
          scope: data.scope ?? null,
        });
        return;
      }

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

  /**
   * An NFC tap's payment went out, or may have: its flow is over, and the
   * context keeps nothing (request, intent, amount, mint) that choosing a
   * mint or an amount could rebuild a preview from for Pay to send again.
   */
  function forgetNfcPayment(): void {
    flowCtx = {
      unit: flowCtx.unit,
      source: flowCtx.source,
      rawInput: flowCtx.rawInput,
      offline: flowCtx.offline,
    };
  }

  /**
   * Lets go of a tap's tag session, once. A newer read took the session
   * over, so a tap whose read is no longer the latest leaves it alone.
   */
  async function releaseNfcSession(tap: NfcTap): Promise<void> {
    if (tap.session === "released") return;
    tap.session = "released";
    await releaseNfcRead(tap.adapter, tap.read);
  }

  /** Lets go of a read's tag session unless a newer read took it over. */
  async function releaseNfcRead(
    adapter: NfcIOAdapter,
    read: number,
  ): Promise<void> {
    if (read !== nfcRead) {
      logger.info("machine.nfc.release.skipped", { reason: "newerRead" });
      return;
    }
    await adapter.releaseSession();
  }

  /**
   * After a scan: an NFC read no tap took still holds its tag session, so it
   * lets go of it here. One the machine dropped because a payment was being
   * made tells the host the scan did not go through.
   */
  async function endUntakenNfcRead(origin: ScanOrigin): Promise<void> {
    const handover = origin.nfc;
    if (!handover || handover.taken === "tap" || !nfcAdapter) return;
    logger.info("machine.nfc.read.notTaken", { reason: handover.taken });
    await releaseNfcRead(nfcAdapter, handover.read).catch((error: unknown) => {
      logger.warn("machine.nfc.release.failed", { error: errField(error) });
    });
    if (handover.taken === "dropped") {
      tell("onScanError", () =>
        notifications?.onScanError?.(
          "nfc",
          new Error("NFC read not taken: a payment is in progress"),
        ),
      );
    }
  }

  /**
   * Ends an NFC tap however it left: releases the tag session unless the
   * write-back did, and switches the unit back unless the tap paid. It does
   * both for a tap a reset or a newer turn overtook as well, each only while
   * it is still the tap's own, then returns false, and that turn returns
   * without touching the machine.
   */
  async function endNfcTap(
    tap: NfcTap,
    end: NfcTapEnd,
    generation: number,
  ): Promise<boolean> {
    await releaseNfcSession(tap).catch((error: unknown) => {
      logger.warn("machine.nfc.release.failed", { error: errField(error) });
    });
    if (end.kind !== "paid" && latestNfcTap === tap) {
      await tap.unitSwitch?.restore().catch(() => undefined);
    }
    return !isStaleGeneration(generation, "nfc.tap.end");
  }

  // Every exit of a turn goes through `finishTurn`, except a stale
  // continuation, which returns: it owns nothing. `origin` is set for the
  // EXECUTE of a scan.
  const runTurn = async (
    event: FlowEvent,
    origin: ScanOrigin | null,
  ): Promise<void> => {
    const sendGeneration = beginTurn(event.type);
    if (sendGeneration === null) {
      if (origin?.nfc) origin.nfc.taken = "dropped";
      return;
    }
    const stale = (op: string) => isStaleGeneration(sendGeneration, op);
    // This caller's result holder, taken before anything awaits: only this
    // turn's own send settles it, so a tap that sends nothing stays
    // `ignored` whatever a later turn delivers.
    const settleConfirm =
      event.type === "CONFIRM_PAYMENT_REQUEST" ? takeConfirms() : () => {};
    logger.info("machine.event.received", {
      type: event.type,
      currentStep: step,
      flowSource: flowCtx.source,
      intentType: flowCtx.intent?.type,
      hasMintUrl: !!flowCtx.mintUrl,
      hasAmount: flowCtx.amount != null,
      unit: flowCtx.unit,
    });

    // A settled payment is final for its flow: only another flow leaves it.
    if (
      (step === "sendComplete" ||
        ((step === "navigateToMeltPreview" ||
          step === "navigateToPaymentRequest") &&
          !awaitsPay((stepData as StepDataMap[typeof step]).phase))) &&
      !LEAVES_SETTLED_PAYMENT[event.type]
    ) {
      logger.info("machine.event.unhandled", {
        type: event.type,
        currentStep: step,
        reason: "paymentSettled",
      });
      finishTurn(sendGeneration, "paymentSettled", QUIET_EXIT);
      return;
    }

    // Handle CONFIRM_MELT/CONFIRM_PAYMENT_REQUEST directly — these bypass transition().
    // On success: the step data's phase becomes `settled` but the step stays
    //   unchanged (the user is already on the screen — no re-navigation needed).
    // On failure: step changes to chooseFallbackOption or error, and the handler is dispatched.

    // If the user opened the mint selector from a preview and dismissed it
    // without selecting, the step is stuck on selectMint while the UI is still
    // showing the preview. Restore the preview from context so the CONFIRM_*
    // guards can match. Only a list opened over a preview awaiting Pay
    // restores one: a context left from a payment that went out (an NFC tap
    // that paid) must never come back as a preview Pay sends again.
    if (
      step === "selectMint" &&
      (event.type === "CONFIRM_MELT" ||
        event.type === "CONFIRM_PAYMENT_REQUEST") &&
      mintListOverPreview &&
      flowCtx.mintUrl &&
      flowCtx.amount
    ) {
      const destination = flowCtx.meltTarget
        ? "meltQuote"
        : flowCtx.paymentRequest
          ? "paymentRequest"
          : null;
      if (destination) {
        const preview = previewStep(destination, flowCtx, {
          mintUrl: flowCtx.mintUrl,
          amount: flowCtx.amount,
          unit: flowCtx.unit,
        });
        if (preview.step === "navigateToMeltPreview") {
          setStep(preview.step, {
            ...preview.data,
            // Carry the pre-created quote (BTC-05) so Pay still executes
            // against the quote whose fee the user saw.
            ...(meltQuotePreviewMatches(flowCtx.meltQuotePreview, preview.data)
              ? { meltQuote: flowCtx.meltQuotePreview }
              : {}),
          });
        } else {
          setStep(preview.step, preview.data);
        }
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
      tell("onMissingMintForAmount", () => notifications?.onMissingMintForAmount?.());
      try {
        await dispatchHandler(step, stepData);
      } finally {
        finishTurn(sendGeneration, "confirm.noMintSelected");
      }
      return;
    }

    // The melt or payment request this turn settled, for the tail both share.
    let settledPayment: {
      fromStep: FlowStep;
      finalize: string;
      unlock: string;
    } | null = null;

    if (
      event.type === "CONFIRM_MELT" &&
      step === "navigateToMeltPreview" &&
      operations?.executeMelt
    ) {
      const originalStep = step;
      // A paid preview never reaches here (see the settled guard above): a
      // second executeMelt would pay twice. A failed attempt leaves the
      // phase `preview`, so Pay after a failure still retries.
      const data = stepData as StepDataMap["navigateToMeltPreview"];
      if (
        data.meltQuote?.expiresAt != null &&
        data.meltQuote.expiresAt <= Date.now() / 1000 &&
        operations.quoteMelt
      ) {
        // The previous approval expired. Show the new quote and require a
        // second tap, even when the fee happens to be unchanged.
        try {
          setExecuting(true);
          const refreshed = await runMeltQuotePreviewEffect({
            data,
            operation: operations.quoteMelt,
            isStale: stale,
          });
          if (refreshed.isOk()) {
            if (refreshed.value.kind === "stale") return;
            flowCtx = { ...flowCtx, meltQuotePreview: refreshed.value.quote };
            setStep("navigateToMeltPreview", {
              ...data,
              meltQuote: refreshed.value.quote,
            });
          } else {
            routeOperationFailure(
              refreshed.error.cause,
              "melt",
              data.meltTarget,
              data,
            );
          }
          await dispatchHandler(step, stepData);
        } finally {
          finishTurn(sendGeneration, "confirmMelt.refreshQuote");
        }
        return;
      }
      logger.info("machine.confirmMelt.start", {
        ...mintUrlFields(data.mintUrl),
        amount: data.amount,
        meltTargetLength: data.meltTarget?.length ?? 0,
      });
      announcePaymentStart(sendGeneration, "confirmMelt.start");

      tell("onPaymentProcessing", () =>
        notifications?.onPaymentProcessing?.({
          variant: "melt",
          mintUrl: data.mintUrl,
          amount: data.amount,
          unit: data.unit,
          // The quote method lives on the flow context, not the step data —
          // lets the wallet gate the in-progress indicator per method.
          ...(flowCtx.meltQuoteMethod ? { method: flowCtx.meltQuoteMethod } : {}),
          // The quote `runConfirmMeltEffect` executes against.
          ...(data.meltQuote ? { quoteId: data.meltQuote.quoteId } : {}),
        }),
      );

      beginCommit(sendGeneration);
      let effect: Awaited<ReturnType<typeof runConfirmMeltEffect>>;
      try {
        effect = await runConfirmMeltEffect({
          data,
          operation: operations.executeMelt,
          context: flowCtx,
          isStale: stale,
        });
      } finally {
        endCommit(sendGeneration);
      }

      if (effect.isOk()) {
        if (effect.value.kind === "stale") return;
        logger.info("machine.melt.success", { ...mintUrlFields(data.mintUrl) });
        setStep(effect.value.step, effect.value.data);
        announcePayment(effect.value);
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

      settledPayment = {
        fromStep: originalStep,
        finalize: "executeMelt.finalize",
        unlock: "confirmMelt.unlock",
      };
    }

    if (
      event.type === "CONFIRM_PAYMENT_REQUEST" &&
      step === "navigateToPaymentRequest" &&
      operations?.executePaymentRequest
    ) {
      const originalStep = step;
      // A delivered or undelivered preview never reaches here (see the
      // settled guard above), so its caller's outcome stays `ignored`.
      const data = stepData as StepDataMap["navigateToPaymentRequest"];
      logger.info("machine.confirmPaymentRequest.start", {
        ...mintUrlFields(data.mintUrl),
        amount: data.amount,
        paymentRequestLength: data.paymentRequest.length,
      });
      announcePaymentStart(sendGeneration, "confirmPaymentRequest.start");

      tell("onPaymentProcessing", () =>
        notifications?.onPaymentProcessing?.({
          variant: "paymentRequest",
          mintUrl: data.mintUrl,
          amount: data.amount,
          unit: data.unit,
        }),
      );

      beginCommit(sendGeneration);
      let effect: Awaited<ReturnType<typeof runConfirmPaymentRequestEffect>>;
      try {
        effect = await runConfirmPaymentRequestEffect({
          data,
          operation: operations.executePaymentRequest,
          context: flowCtx,
          isStale: stale,
        });
      } finally {
        endCommit(sendGeneration);
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
          settleConfirm({ kind: "rolledBack" });
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
          settleConfirm({ kind: "delivered" });
          setStep(effect.value.step, effect.value.data);
          announcePayment(effect.value);
        }
      } else {
        logger.warn("machine.paymentRequest.failed", {
          error: errField(effect.error.cause),
        });
        const cause = effect.error.cause;
        const undelivered = cause instanceof PaymentRequestUndeliveredError;
        settleConfirm(
          undelivered
            ? { kind: "undelivered", operationId: cause.operationId }
            : { kind: "failed" },
        );
        if (undelivered) {
          setStep("navigateToPaymentRequest", {
            ...data,
            phase: { kind: "undelivered", operationId: cause.operationId },
          });
        }
        routeOperationFailure(cause, "paymentRequest", data.paymentRequest, data, {
          undelivered,
        });
      }

      settledPayment = {
        fromStep: originalStep,
        finalize: "executePaymentRequest.finalize",
        unlock: "confirmPaymentRequest.unlock",
      };
    }

    // After a melt or a payment request settled: stop executing, run the
    // handler of the step the result moved to while still holding the machine
    // (so a second Pay cannot race the navigation), then finish the turn.
    // Inline rather than a helper, so Pay settles as soon as the turn ends.
    if (settledPayment) {
      if (stale(settledPayment.finalize)) return;
      try {
        setExecuting(false);
        if (step !== settledPayment.fromStep) {
          await dispatchHandler(step, stepData);
          notify();
        }
      } finally {
        finishTurn(sendGeneration, settledPayment.unlock, QUIET_EXIT);
      }
      return;
    }

    // Wrap the main transition path so the turn always finishes, even if
    // transition() or an operation throws unexpectedly.
    try {
      let postDispatchTask: Promise<void> | null = null;
      let walletCtx = getContext();
      let unit = currentUnit();
      let nfcError: StepDataMap["error"] | undefined;
      const nfcTap: NfcTap | null =
        event.type === "EXECUTE" && origin?.nfc && nfcAdapter
          ? {
              input: event.input,
              adapter: nfcAdapter,
              read: origin.nfc.read,
              session: "held",
              unitSwitch: null,
            }
          : null;
      if (nfcTap && origin?.nfc) {
        origin.nfc.taken = "tap";
        latestNfcTap = nfcTap;
      }
      // Every read of the wallet context below goes through `readContext`,
      // which keeps the balances in the unit the tap switched the host to.
      const readContext = (): ReturnType<typeof getContext> => {
        const ctx = getContext();
        const switchedUnit = nfcTap?.unitSwitch?.unit;
        if (!switchedUnit) return ctx;
        // No balances for the unit after all: no mint can pay, rather than
        // the old unit's balances standing in for them.
        return {
          ...ctx,
          mintBalances: ctx.unitBalances?.[switchedUnit.trim().toLowerCase()] ?? {},
        };
      };
      // A terminal chooses one unit. Switch the host's whole cached view before
      // the ordinary transition can reject a cross-unit request (including BIP21).
      if (nfcTap) {
        const request = parsePaymentInput(nfcTap.input, detectors).options.find(
          (option) => option.kind === "paymentRequest",
        );
        const info = request && detectors.getPaymentRequestInfo(request.value);
        if (info) {
          const requestedUnit = (info.unit ?? "sat").trim().toLowerCase();
          const amount = info.amount;
          if (info.hasSpendingCondition || info.lockP2pkPubkey) {
            nfcError = {
              code: "UNSUPPORTED_PAYMENT_METHOD",
              message:
                "This request requires locked ecash, which NFC payments do not support yet.",
            };
          } else if (!isValidSatAmount(amount)) {
            nfcError = {
              code: "NFC_READ_FAILED",
              message: "Payment request must include an amount for NFC payment",
            };
          } else if (requestedUnit !== unit.trim().toLowerCase()) {
            const funded = walletCtx.trustedMintUrls.some(
              (mintUrl) =>
                (info.mintsPreferred ||
                  info.mints.length === 0 ||
                  info.mints.includes(mintUrl)) &&
                (walletCtx.unitBalances?.[requestedUnit]?.[mintUrl] ?? 0) >=
                  amount,
            );
            if (!funded) {
              nfcError = {
                code: "UNIT_NOT_FUNDED",
                message: t("UNIT_NOT_FUNDED", currentLocale(), {
                  unit: requestedUnit.toUpperCase(),
                }),
              };
            } else if (operations?.switchUnit) {
              tell("onNfcPaymentProgress", () =>
                notifications?.onNfcPaymentProgress?.({ phase: "selecting" }),
              );
              const switchUnit = operations.switchUnit;
              const previousUnit = unit;
              const switched = await ResultAsync.fromThrowable(async () =>
                switchUnit(requestedUnit),
              )();
              if (switched.isErr()) {
                nfcError = {
                  code: "NFC_READ_FAILED",
                  message: t("NFC_UNIT_SWITCH_FAILED", currentLocale()),
                };
              }
              unit = currentUnit();
              if (switched.isOk()) {
                nfcTap.unitSwitch = {
                  unit,
                  restore: async () => {
                    await switchUnit(previousUnit);
                  },
                };
              }
              if (stale("nfc.switchUnit")) {
                await endNfcTap(nfcTap, { kind: "stopped" }, sendGeneration);
                return;
              }
              // A bound context catches up with the unit only when React next
              // re-runs its binding, so its `mintBalances` may still be the old
              // unit's here. `unitBalances` holds every unit and does not lag:
              // it is what found this request funded above.
              walletCtx = readContext();
              // A missing/unsupported host switch keeps the existing unit hard-stop.
            }
          }
        }
      }

      // Resolve current offline status once per event. Passed into
      // transition() so every code path (EXECUTE, AMOUNT_ENTERED, etc.)
      // sees the real-time value from the provider.
      const offline = currentOffline();

      const eventForTransition =
        event.type === "AMOUNT_ENTERED"
          ? {
              ...event,
              offline: event.offline ?? offline,
            }
          : event;

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
      const result = nfcError
        ? { step: "error" as const, context: { unit }, data: nfcError }
        : transition(
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

      if ("kind" in result) {
        // No transition: keep the step and its data, dispatch nothing.
        logger.info("machine.event.unhandled", {
          type: event.type,
          currentStep: step,
        });
        finishTurn(sendGeneration, "transition.unchanged");
        return;
      }
      flowCtx = result.context;
      setStep(result.step, result.data);
      // A list opened while the list is already open keeps what it was
      // opened over.
      if (event.type === "REQUEST_MINT_SELECTOR" && prevStep !== "selectMint") {
        mintListOverPreview =
          prevStep === "navigateToMeltPreview" ||
          prevStep === "navigateToPaymentRequest";
      }
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
        const scanSource = origin?.source;
        flowCtx.source = scanSource;
        if (notifications?.onScanResolved && flowCtx.parsed) {
          const optionKinds =
            flowCtx.parsed.options.length > 0
              ? [...new Set(flowCtx.parsed.options.map((o) => o.kind))]
              : undefined;
          const resolved = {
            rawInput: event.input,
            parsedType: flowCtx.parsed.type ?? "unknown",
            intentType: flowCtx.intent?.type ?? "unknown",
            source: scanSource,
            container: flowCtx.parsed.container ?? undefined,
            optionKinds,
          };
          tell("onScanResolved", () => notifications?.onScanResolved?.(resolved));
        }
      }

      if (eventForTransition.type === "AMOUNT_ENTERED") {
        const e = eventForTransition;
        if (e.amount > 0 && !String(e.mintUrl ?? "").trim()) {
          tell("onMissingMintForAmount", () => notifications?.onMissingMintForAmount?.());
        }
      }

      // Mint selection notifications: scope 'npc' → onNpcMintChanged;
      // 'bolt12'/'onchain' → onReceiveMethodMintChanged; else →
      // onPreferredMintChanged when applicable.
      if (event.type === "MINT_SELECTED") {
        if (event.scope === "npc") {
          tell("onNpcMintChanged", () =>
            notifications?.onNpcMintChanged?.({ mintUrl: event.mintUrl }),
          );
        } else if (event.scope === "bolt12" || event.scope === "onchain") {
          const change = { method: event.scope, mintUrl: event.mintUrl };
          tell("onReceiveMethodMintChanged", () =>
            notifications?.onReceiveMethodMintChanged?.(change),
          );
        } else {
          const isPersistOnlyPath = step === "dismiss" && !flowCtx.destination;
          const shouldPersist = event.persist ?? isPersistOnlyPath;
          if (shouldPersist) {
            tell("onPreferredMintChanged", () =>
              notifications?.onPreferredMintChanged?.({ mintUrl: event.mintUrl }),
            );
          }
        }
      }

      // NFC auto-resolve: when the scan came from a tag and an adapter is
      // available, automatically resolve interactive steps (option choice,
      // mint selection) and auto-execute payment request sends with NFC
      // write-back. Only the EXECUTE that delivered the tag's payload is
      // hands-free: the tag session is released as soon as the flow parks on
      // a screen, and every event after that is the user's own tap.
      // `flowCtx.source` stays 'nfc' for the flow's lifetime (transaction
      // tagging), so it alone must not re-arm the resolver — a later
      // REQUEST_MINT_SELECTOR from the preview's mint pill used to open
      // selectMint and immediately auto-pick the same mint again, so the
      // list never appeared.
      if (nfcTap) {
        let end: NfcTapEnd | null = null;
        // A BIP321 tag usually carries a Lightning invoice next to the ecash
        // request. When the ecash path is chosen first and then turns out to
        // be unpayable (no mint passes the payment-request gate), the option
        // screen's state is restored from here and the invoice is chosen
        // instead of dead-ending on an error the user can do nothing about.
        let nfcAlternative: {
          ctx: FlowContext;
          data: StepDataMap["chooseOption"];
          option: StepDataMap["chooseOption"]["options"][number];
        } | null = null;
        // Mints the payment-request gate has already refused this tap, with
        // the reason, so re-selection never lands on them again.
        const nfcRefusedMints = new Map<string, string>();
        const nfcPayableMints = new Set<string>();
        // Moves the tap's flow on by one event, keeping it tagged as NFC.
        // Every event the loop sends moves to a step, so "unchanged" (false)
        // is not reached.
        const advanceNfc = (
          nfcEvent: FlowEvent,
          walletCtxForEvent = readContext(),
        ): boolean => {
          const r = transition(
            step,
            flowCtx,
            nfcEvent,
            detectors,
            walletCtxForEvent,
            currentUnit(),
            offline,
            enableEcashSendMemo,
            getSatsPerUnitMinor,
          );
          if ("kind" in r) return false;
          flowCtx = r.context;
          flowCtx.source = "nfc";
          setStep(r.step, r.data);
          return true;
        };

        // Loop because auto-resolving one step (e.g. chooseOption) may produce
        // another step (e.g. selectMint) that also needs auto-resolution.
        try {
          while (!end) {
            if (step === "chooseOption" || step === "chooseFallbackOption") {
              const optionData = stepData as StepDataMap["chooseOption"];
              const options = optionData.options;
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
                const invoiceAlternative =
                  best.option.kind === "paymentRequest"
                    ? options.find(
                        (o) =>
                          o !== best &&
                          o.option.kind === "lightningInvoice" &&
                          o.status !== "disabled",
                      )
                    : undefined;
                nfcAlternative = invoiceAlternative
                  ? { ctx: { ...flowCtx }, data: optionData, option: invoiceAlternative }
                  : null;
                logger.info("machine.nfc.optionChosen", {
                  kind: best.option.kind,
                  optionCount: options.length,
                  hasInvoiceFallback: !!invoiceAlternative,
                });
                if (!advanceNfc({ type: "OPTION_CHOSEN", option: best.option })) break;
                continue;
              }
              // No viable option
              logger.info("machine.nfc.noViableOption", {
                optionCount: options.length,
              });
              end = { kind: "stopped" };
            } else if (step === "selectMint") {
              const data = stepData as StepDataMap["selectMint"];
              const walletCtxInner = readContext();
              const info = flowCtx.paymentRequest
                ? detectors.getPaymentRequestInfo(flowCtx.paymentRequest)
                : null;
              const amount = flowCtx.amount ?? 0;
              const ranked = rankMintCandidates(
                data.candidates.filter(
                  (candidate) =>
                    candidate.status !== "disabled" &&
                    !nfcRefusedMints.has(candidate.mintUrl),
                ),
                {
                  preferredMints: info?.mints ?? [],
                  amount,
                  unitBalances:
                    walletCtxInner.unitBalances?.[flowCtx.unit] ??
                    walletCtxInner.mintBalances,
                  canPayLocally: (mintUrl) =>
                    buildProofSuggestions(
                      walletCtxInner.proofAmounts[mintUrl] ?? [],
                      amount,
                    ).exactMatch,
                },
              );
              // A NUT-18 amount is net of the receiver's input fees, and the
              // send cannot add them yet, so `executeNfcSend` refuses a mint
              // whose keysets charge fees. Ask before choosing: the answer is a
              // local keyset read, whereas learning it inside the write-back
              // tore the session down and reported "NFC write failed" for a
              // token that was never created.
              let best: (typeof ranked)[number] | undefined;
              let refusal: string | undefined = [...nfcRefusedMints.values()].at(-1);
              for (const candidate of ranked) {
                const payability = operations?.paymentRequestPayabilityFrom
                  ? await operations.paymentRequestPayabilityFrom({
                      mintUrl: candidate.mintUrl,
                      unit: flowCtx.unit,
                    })
                  : { payable: true as const };
                // Overtaken: the tap's end lets go of the tag and the unit.
                if (stale("nfc.payability")) {
                  end = { kind: "stopped" };
                  break;
                }
                if (payability.payable) {
                  nfcPayableMints.add(candidate.mintUrl);
                  best = candidate;
                  break;
                }
                refusal = payability.reason;
                nfcRefusedMints.set(candidate.mintUrl, payability.reason);
                logger.info("machine.nfc.mintSkipped", {
                  ...mintUrlFields(candidate.mintUrl),
                  reason: payability.reason,
                });
              }
              if (end) continue;
              if (best) {
                logger.info("machine.nfc.mintChosen", {
                  ...mintUrlFields(best.mintUrl),
                  rankedCount: ranked.length,
                });
                tell("onNfcPaymentProgress", () =>
                  notifications?.onNfcPaymentProgress?.({ phase: "selecting" }),
                );
                if (
                  !advanceNfc(
                    { type: "MINT_SELECTED", mintUrl: best.mintUrl },
                    walletCtxInner,
                  )
                ) {
                  break;
                }
                continue;
              }
              if (nfcAlternative) {
                // Ecash is off the table for this tap; the tag also offered a
                // Lightning invoice, so pay that. The preview step that follows
                // is terminal for the NFC loop: the session is released and the
                // user confirms on screen, exactly as for an invoice-only tag.
                logger.info("machine.nfc.fallbackToInvoice", {
                  reason: refusal ?? "no funded mint",
                  rankedCount: ranked.length,
                });
                const alternative = nfcAlternative;
                nfcAlternative = null;
                flowCtx = alternative.ctx;
                setStep("chooseOption", alternative.data);
                if (
                  !advanceNfc(
                    { type: "OPTION_CHOSEN", option: alternative.option.option },
                    walletCtxInner,
                  )
                ) {
                  break;
                }
                continue;
              }
              // Every funded mint was refused and there is nothing else on the
              // tag: say why, instead of showing a picker whose rows would all
              // fail the same way. No candidates at all: the selectMint handler
              // shows the picker.
              end = refusal
                ? {
                    kind: "stopped",
                    error: { code: "PAYMENT_REQUEST_FAILED", message: refusal },
                  }
                : { kind: "stopped" };
            } else if (step === "enterAmount") {
              // NFC requires amount in payment request — if we reach enterAmount, the request lacked it
              end = {
                kind: "stopped",
                error: {
                  code: "NFC_READ_FAILED",
                  message: "Payment request must include an amount for NFC payment",
                },
              };
            } else if (
              step === "navigateToPaymentRequest" &&
              operations?.executeNfcSend
            ) {
              const data = stepData as StepDataMap["navigateToPaymentRequest"];
              // The resolver picks a mint without a picker when one is the
              // obvious choice (the terminal's only listed mint, the preferred
              // mint). Apply the same gate here as in selectMint before money
              // moves; a refusal re-opens selection with this mint excluded,
              // and selectMint then finds another mint, the tag's invoice, or
              // the reason to show.
              if (
                operations.paymentRequestPayabilityFrom &&
                !nfcRefusedMints.has(data.mintUrl) &&
                !nfcPayableMints.has(data.mintUrl)
              ) {
                const payability = await operations.paymentRequestPayabilityFrom({
                  mintUrl: data.mintUrl,
                  unit: data.unit,
                });
                // Overtaken: the tap's end lets go of the tag and the unit.
                if (stale("nfc.payability")) {
                  end = { kind: "stopped" };
                  continue;
                }
                if (!payability.payable) {
                  nfcRefusedMints.set(data.mintUrl, payability.reason);
                  logger.info("machine.nfc.mintRefused", {
                    ...mintUrlFields(data.mintUrl),
                    reason: payability.reason,
                  });
                  if (!advanceNfc({ type: "REQUEST_MINT_SELECTOR" })) break;
                  continue;
                }
              }
              // Auto-execute: create token → write back to NFC tag
              setExecuting(true);

              beginCommit(sendGeneration);
              let effect: Awaited<ReturnType<typeof runNfcWriteBackEffect>>;
              try {
                effect = await runNfcWriteBackEffect({
                  data,
                  executeNfcSend: operations.executeNfcSend,
                  rollbackSend: operations.rollbackSend,
                  nfcAdapter: {
                    writeToken: (token) => nfcTap.adapter.writeToken(token),
                    releaseSession: () => releaseNfcSession(nfcTap),
                  },
                  context: flowCtx,
                  onProgress: (progress) => {
                    tell("onNfcPaymentProgress", () =>
                      notifications?.onNfcPaymentProgress?.(progress),
                    );
                  },
                  isStale: stale,
                  locale: currentLocale(),
                });
              } finally {
                endCommit(sendGeneration);
              }
              // The write-back released the session, whatever it reports.
              nfcTap.session = "released";

              if (effect.isOk()) {
                if (effect.value.kind === "stale") {
                  // Overtaken: a token on the tag is paid, and keeps the unit.
                  end = effect.value.delivered ? { kind: "paid" } : { kind: "stopped" };
                  continue;
                }
                setStep(effect.value.step, effect.value.data);
                forgetNfcPayment();
                announcePayment(effect.value);
                end = { kind: "paid" };
              } else {
                for (const notification of effect.error.notifications) {
                  if (notification.type === "onNfcWriteFailed") {
                    tell("onNfcWriteFailed", () =>
                      notifications?.onNfcWriteFailed?.(notification.data),
                    );
                  }
                }

                setStep("error", effect.error.data);
                // Its token may have reached the terminal: like an
                // undelivered send, it is not offered again.
                if (effect.error.tokenOutstanding) forgetNfcPayment();
                end = { kind: "stopped" };
              }

              setExecuting(false, false);
            } else {
              // Terminal step that isn't navigateToPaymentRequest (e.g. navigateToMeltPreview,
              // error, receiveToken) — release NFC session and proceed normally.
              end = { kind: "stopped" };
            }
          }
        } catch (error) {
          // A throw ends the tap too, before the safety net finishes the turn.
          end = { kind: "threw", error };
        }

        // The loop always leaves with an end; a missing one is a stop.
        const tapEnd: NfcTapEnd = end ?? { kind: "stopped" };
        if (!(await endNfcTap(nfcTap, tapEnd, sendGeneration))) return;
        if (tapEnd.kind === "threw") throw tapEnd.error;
        if (tapEnd.kind === "stopped" && tapEnd.error) setStep("error", tapEnd.error);
      }

      // Intercept action steps when operations are provided.
      // The machine runs the operation internally, then re-targets to
      // a result step (sendComplete, mintQuoteCreated) or fallback (chooseProofs, error).
      if (operations) {
        if (step === "confirmSend") {
          const data = stepData as StepDataMap["confirmSend"];
          const walletCtx = getContext();
          const proofAmounts = walletCtx.proofAmounts[data.mintUrl] ?? [];
          // Which path the send takes is decided, and logged, by the effect.
          logger.info("machine.confirmSend.start", {
            ...mintUrlFields(data.mintUrl),
            amount: data.amount,
          });
          setExecuting(true);
          beginCommit(sendGeneration);
          let effect: Awaited<ReturnType<typeof runConfirmSendEffect>>;
          try {
            effect = await runConfirmSendEffect({
              data,
              operations,
              context: flowCtx,
              proofAmounts,
              getOffline: currentOffline,
              getLocale: currentLocale,
              isStale: stale,
            });
          } finally {
            endCommit(sendGeneration);
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
                  tell("onTransactionCreated", () =>
                    notifications?.onTransactionCreated?.(notification.data),
                  );
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
            const lockFallback = lockFallbackFor(
              { ...data, unit: flowCtx.unit },
              effect.error.data,
            );
            if (lockFallback) {
              logger.info("machine.sendFallback.offered", { failed: "locked-ecash", id: "ecash" });
              setStep("chooseSendFallback", lockFallback);
            } else {
              setStep("error", effect.error.data);
            }
          }
          setExecuting(false);
        } else if (step === "createMintQuote") {
          const data = stepData as StepDataMap["createMintQuote"];
          logger.info("machine.createMintQuote.start", {
            ...mintUrlFields(data.mintUrl),
            amount: data.amount,
            method: data.method ?? "bolt11",
          });
          setExecuting(true);
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
            getOffline: currentOffline,
            getLocale: currentLocale,
            isStale: stale,
          });

          if (effect.isOk()) {
            if (effect.value.kind === "stale") return;
            logger.info("machine.createMintQuote.success");
            setStep(effect.value.step, effect.value.data);

            for (const notification of effect.value.notifications) {
              if (notification.type === "onTransactionCreated") {
                tell("onTransactionCreated", () =>
                  notifications?.onTransactionCreated?.(notification.data),
                );
              }
            }
          } else {
            logger.warn("machine.createMintQuote.failed", {
              error: errField(effect.error.cause),
            });
            setStep("error", effect.error.data);
          }
          setExecuting(false);
        } else if (step === "createPaymentRequestReceive") {
          const data = stepData as StepDataMap["createPaymentRequestReceive"];
          logger.info("machine.createPaymentRequestReceive.start", {
            amount: data.amount,
            unit: data.unit,
          });
          setExecuting(true);
          // Deliberately NOT commit-generation enrolled — same rationale as
          // createMintQuote above (supersede-on-resubmit is designed).
          const effect = await runPaymentRequestReceiveEffect({
            data,
            operations,
            isStale: stale,
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
          setExecuting(false);
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
        setExecuting(true);

        const effect = await runMintReviewInfoEffect({
          step: reviewStep,
          data: reviewData,
          operation: operations.buildMintReviewInfo,
          getLocale: currentLocale,
          isStale: stale,
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
        setExecuting(false);
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
        const matching = meltQuotePreviewMatches(flowCtx.meltQuotePreview, data)
          ? flowCtx.meltQuotePreview
          : undefined;
        if (matching) {
          if (!data.meltQuote) {
            setStep("navigateToMeltPreview", { ...data, meltQuote: matching });
          }
        } else {
          setExecuting(true);
          const effect = await runMeltQuotePreviewEffect({
            data,
            operation: operations.quoteMelt,
            isStale: stale,
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
          setExecuting(false);
        }
      }

      // Dispatch notification for error steps (fire-and-forget).
      if (step === "error" && notifications) {
        const errorData = stepData as StepDataMap["error"];
        const notificationHandler = notifications[errorData.code];
        if (notificationHandler) {
          tell(errorData.code, () => notificationHandler(errorData));
        }
      }

      if (INPUT_STEPS.has(step)) notify();
      else setExecuting(true);

      try {
        await dispatchHandler(step, stepData);
        if (stale("dispatchHandler")) return;
        if (postDispatchTask) {
          // Preserve the existing selectMint timing: handlers receive fallback
          // rows first, then immediately-settled enrichment can land before the
          // machine action promise resolves.
          await Promise.race([
            postDispatchTask,
            new Promise<void>((resolve) => setTimeout(resolve, 0)),
          ]);
          if (stale("dispatchHandler.postTask"))
            return;
        }
      } finally {
        // A superseded turn returns here, which also swallows its handler's
        // throw; otherwise the throw reaches the safety net below.
        if (!finishTurn(sendGeneration, "dispatchHandler.finally")) return;
      }
    } catch (err) {
      // Safety net: finish the turn so the machine doesn't stay held if
      // transition() or an operation throws before the inner finally runs.
      if (stale("machine.transition.safetyNet")) return;
      logger.warn("machine.transition.safetyNet", { error: errField(err) });
      finishTurn(sendGeneration, "machine.transition.safetyNet");
    }
  };

  const send = (event: FlowEvent): Promise<void> => runTurn(event, null);

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

  async function processScanData(
    data: string,
    origin: ScanOrigin,
  ): Promise<ProcessResult> {
    const isUR = data.startsWith("ur:") || data.startsWith("UR:");
    if (isUR && createURDecoder && urDecoder) {
      urDecoder.receivePart(data);
      const nextProgress = urDecoder.getProgress();

      if (urDecoder.isComplete() && urDecoder.isSuccess()) {
        const decoded = urDecoder.resultUR().decodeCBOR();
        const decodedString = new TextDecoder().decode(decoded);
        await runTurn({ type: "EXECUTE", input: decodedString }, origin);
        urDecoder = createURDecoder();
        return { urInProgress: false };
      }

      return { urInProgress: true, progress: nextProgress };
    }

    if (processedScanInput === data) {
      return { urInProgress: false };
    }

    processedScanInput = data;
    await runTurn({ type: "EXECUTE", input: data }, origin);
    const lockedPending = cachedSnapshot.step === "chooseOption";
    if (!lockedPending) processedScanInput = null;

    return { urInProgress: false, lockedPending };
  }

  const scan =
    createURDecoder || scanSources
      ? async (
          data?: string,
          options?: ScanOptions,
        ): Promise<ProcessResult> => {
          if (options?.reset) resetInternal();

          const hasData = data != null && data.length > 0;
          const scanSource =
            options?.source ?? (hasData ? undefined : "clipboard");
          // An NFC read takes the tag session over from any read before it.
          const origin: ScanOrigin = {
            source: scanSource,
            nfc: scanSource === "nfc" ? { read: ++nfcRead, taken: "no" } : null,
          };

          if (hasData) {
            try {
              return await processScanData(data, origin);
            } finally {
              await endUntakenNfcRead(origin);
            }
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
            tell("onScanError", () =>
              notifications?.onScanError?.(
                source,
                err instanceof Error ? err : new Error(String(err)),
              ),
            );
            return { urInProgress: false };
          }

          if ("canceled" in result && result.canceled) {
            return { urInProgress: false };
          }
          if ("empty" in result && result.empty) {
            tell("onScanEmpty", () => notifications?.onScanEmpty?.(source));
            return { urInProgress: false };
          }
          if ("error" in result && result.error) {
            tell("onScanError", () => notifications?.onScanError?.(source, result.error));
            return { urInProgress: false };
          }
          if ("data" in result && result.data) {
            try {
              return await processScanData(result.data, origin);
            } finally {
              await endUntakenNfcRead(origin);
            }
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
      /** See the AMOUNT_ENTERED event — tri-state: leave, clear, or set. */
      p2pkLock?: P2pkLockSpec | null;
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
      ...(opts && "p2pkLock" in opts ? { p2pkLock: opts.p2pkLock } : {}),
      amountEntryDisplay: opts?.amountEntryDisplay,
    });

  const chooseOption = (option: PaymentOption) =>
    send({ type: "OPTION_CHOSEN", option });

  const chooseProofs = (amount: number) =>
    send({ type: "PROOFS_CHOSEN", amount });

  const chooseSendFallback = async (id: SendFallbackId | null) => {
    const retry = sendFallback;
    sendFallback = null;
    logger.info("machine.sendFallback.chosen", { id, hasRetry: !!retry });
    if (!retry || step !== "chooseSendFallback") return;
    if (id === null) {
      setStep("error", retry.error);
      notify();
      return;
    }
    const recipient = {
      ...(flowCtx.recipientPubkey ? { recipientPubkey: flowCtx.recipientPubkey } : {}),
      ...(flowCtx.recipientProfile ? { recipientProfile: flowCtx.recipientProfile } : {}),
    };
    const amount = { value: retry.amount, unit: retry.unit };
    if (id === "ecash") {
      await enterAmount(amount, retry.mintUrl, {
        destination: "sendEcash",
        p2pkLock: null,
        ...recipient,
      });
    } else if (retry.npcTarget) {
      await enterAmount(amount, retry.mintUrl, {
        destination: "meltQuote",
        meltQuoteMethod: "bolt11",
        meltTarget: retry.npcTarget,
        ...recipient,
      });
    }
  };

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
    p2pkLock?: P2pkLockSpec;
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
      ...(opts?.p2pkLock ? { p2pkLock: opts.p2pkLock } : {}),
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

  const confirmMelt = () => send({ type: "CONFIRM_MELT" });
  const confirmPaymentRequest = async (): Promise<PaymentRequestConfirmOutcome> => {
    const holder = registerConfirm();
    try {
      await send({ type: "CONFIRM_PAYMENT_REQUEST" });
      return holder.outcome;
    } finally {
      unregisterConfirm(holder);
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
    chooseSendFallback,
    submitSendMemo,
    changeMint,
    requestMintSelector,
    startSend,
    startSendEcash,
    startReceiveLightning,
    startReceive,
    showReceiveQr,
    reviewMint,
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
