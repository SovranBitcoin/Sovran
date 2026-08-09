import { resolveIntent } from "../intent";
import { logger, mintUrlFields } from "../logger";
import { createAmountEntryMethodContext } from "../mint-capabilities";
import { parsePaymentInput } from "../parse";
import { isValidSatAmount } from "../guards";
import { normalizeNostrPubkey } from "../recipient";
import type { Detectors, WalletContext } from "../types";
import { resolveNext, type StepResult } from "./resolveNext";
import { buildProofSuggestions } from "./amountFallback";
import type { FlowContext, FlowEvent, FlowStep } from "./types";
import { startSendFlow, startSendEcashFlow } from "./flows/send";
import {
  startReceiveFlow,
  startReceiveLightningFlow,
  startReceiveQrFlow,
} from "./flows/receive";
import { requestMintSelector, resolveFromContext } from "./contextResolution";

// ---------------------------------------------------------------------------
// Transition result — new step + merged context
// ---------------------------------------------------------------------------

export interface TransitionResult {
  step: FlowStep;
  context: FlowContext;
  data: StepResult["data"];
}

function apply(result: StepResult, ctx: FlowContext): TransitionResult {
  const merged = result.contextPatch ? { ...ctx, ...result.contextPatch } : ctx;
  return { step: result.step, context: merged, data: result.data };
}

// ---------------------------------------------------------------------------
// Per-event transition handlers
// ---------------------------------------------------------------------------

/**
 * Seed a scanned fixed amount into the flow context. Scanned amounts are
 * ALWAYS sat-denominated (BIP-321 `amount=`, fixed bolt11/bolt12 decodes),
 * but `ctx.amount` must stay denominated in `ctx.unit` — every downstream
 * consumer (preview display, balance/capability gates, `executeMelt`'s
 * fiat→sat conversion) assumes that invariant. On a fiat-unit account the
 * sats are therefore re-denominated to the active unit ONCE here. Without a
 * live rate (or when the amount is below one minor unit) the amount is left
 * unseeded so the flow bounces to amount entry — never book sats into a
 * fiat context, which would double-convert at execution (BTC-02).
 */
function seedScannedSatAmount(
  ctx: FlowContext,
  sats: number,
  source: string,
  getSatsPerUnitMinor?: (unit: string) => number | null,
): void {
  if (ctx.unit.toLowerCase() === "sat") {
    ctx.amount = sats;
    return;
  }
  const rate = getSatsPerUnitMinor?.(ctx.unit) ?? null;
  if (rate == null || rate <= 0) {
    logger.warn("transitions.seedScannedAmount.noRate", {
      source,
      unit: ctx.unit,
      sats,
    });
    return;
  }
  const minor = Math.round(sats / rate);
  if (!Number.isSafeInteger(minor) || minor <= 0) {
    logger.warn("transitions.seedScannedAmount.belowMinorUnit", {
      source,
      unit: ctx.unit,
      sats,
      rate,
    });
    return;
  }
  ctx.amount = minor;
}

function handleExecute(
  input: string,
  detectors: Detectors,
  walletCtx: WalletContext,
  unit: string,
  offline?: boolean,
  getSatsPerUnitMinor?: (unit: string) => number | null,
): TransitionResult {
  const parsed = parsePaymentInput(input, detectors);
  const intent = resolveIntent(parsed, detectors, walletCtx);
  logger.info("transitions.execute", {
    parsedType: parsed.type,
    intentType: intent.type,
  });

  const ctx: FlowContext = {
    parsed,
    intent,
    unit,
    rawInput: input,
    offline,
  };

  // Extract known data from the intent into context
  switch (intent.type) {
    case "sendPaymentRequest": {
      // The request's unit must equal the flow unit (the wallet's active
      // unit): the WalletContext (balances, proof amounts, capabilities) is
      // always the active-unit view, and execution selects proofs in that
      // unit while the NUT-18 payload stamps it. Flipping ctx.unit to the
      // request's unit would cross the two contexts — gates compare
      // cross-unit and the paid proofs mislabel their unit (BTC-04). A
      // cross-unit request can't be paid from this view at all, so stop
      // with an actionable error instead of mixing units silently.
      const requestUnit = (intent.info.unit ?? "sat").trim().toLowerCase();
      const activeUnit = unit.trim().toLowerCase();
      if (requestUnit !== activeUnit) {
        logger.warn("transitions.execute.paymentRequestUnitMismatch", {
          requestUnit,
          activeUnit,
        });
        return {
          step: "error",
          context: ctx,
          data: {
            code: "UNSUPPORTED_PAYMENT_METHOD" as const,
            message: `This payment request is denominated in ${requestUnit}, but your wallet is using ${activeUnit}. Switch your wallet unit to ${requestUnit} to pay it.`,
          },
        };
      }
      ctx.paymentRequest = intent.option.value;
      ctx.supportedMintUrls =
        intent.info.mints.length > 0 ? intent.info.mints : undefined;
      if (isValidSatAmount(intent.info.amount)) {
        ctx.amount = intent.info.amount;
      } else if (intent.info.amount != null) {
        logger.warn("transitions.execute.invalidAmount", {
          source: "sendPaymentRequest",
          amount: intent.info.amount,
        });
      }
      // A nostr transport entry is the request's identity disclosure
      // (NUT-18 convention). Seeding recipientPubkey here lets the stage-2
      // profile resolver paint "Pay <name>" on the amount screen for any
      // scanned creq.
      const nostrTransport = intent.info.transports?.find(
        (transport) => transport.type === "nostr",
      );
      if (nostrTransport?.target) {
        const recipientPubkey = normalizeNostrPubkey(nostrTransport.target);
        if (recipientPubkey) ctx.recipientPubkey = recipientPubkey;
      }
      break;
    }
    case "meltLightningInvoice":
      ctx.meltTarget = intent.option.value;
      if (isValidSatAmount(intent.option.amount)) {
        seedScannedSatAmount(
          ctx,
          intent.option.amount,
          "meltLightningInvoice",
          getSatsPerUnitMinor,
        );
      } else if (intent.option.amount != null) {
        logger.warn("transitions.execute.invalidAmount", {
          source: "meltLightningInvoice",
          amount: intent.option.amount,
        });
      }
      break;
    case "meltLightningAddress":
    case "meltLnurlp":
      ctx.meltTarget = intent.option.value;
      break;
    case "meltBolt12Offer":
      ctx.destination = "meltQuote";
      ctx.meltQuoteMethod = "bolt12";
      ctx.meltTarget = intent.option.value;
      // Null today (amountless / quote-first → user enters it). A decoded fixed
      // offer seeds it here, exactly like the fixed bolt11 invoice arm above.
      if (isValidSatAmount(intent.option.amount)) {
        seedScannedSatAmount(
          ctx,
          intent.option.amount,
          "meltBolt12Offer",
          getSatsPerUnitMinor,
        );
      }
      break;
    case "meltOnchainAddress":
      ctx.destination = "meltQuote";
      ctx.meltQuoteMethod = "onchain";
      ctx.meltTarget = intent.option.value;
      if (isValidSatAmount(intent.option.amount)) {
        seedScannedSatAmount(
          ctx,
          intent.option.amount,
          "meltOnchainAddress",
          getSatsPerUnitMinor,
        );
      }
      break;
  }

  return apply(resolveNext(intent, ctx, walletCtx), ctx);
}

function handleOptionChosen(
  option: FlowEvent & { type: "OPTION_CHOSEN" },
  currentCtx: FlowContext,
  detectors: Detectors,
  walletCtx: WalletContext,
  getSatsPerUnitMinor?: (unit: string) => number | null,
): TransitionResult {
  const parsed = currentCtx.parsed;
  if (!parsed) {
    return {
      step: "error",
      context: currentCtx,
      data: {
        code: "UNSUPPORTED_INPUT" as const,
        message: "No parsed input to resolve option from",
      },
    };
  }

  const singleParsed = { ...parsed, options: [option.option] };
  const intent = resolveIntent(singleParsed, detectors, walletCtx);

  // Clear stale intent-specific fields so each option choice starts clean.
  // Without this, switching from payment request → lightning keeps stale
  // supportedMintUrls/paymentRequest that taint mint selection.
  const ctx: FlowContext = {
    ...currentCtx,
    parsed: singleParsed,
    intent,
    destination: undefined,
    mintQuoteMethod: undefined,
    meltQuoteMethod: undefined,
    supportedMintUrls: undefined,
    paymentRequest: undefined,
    meltTarget: undefined,
  };

  // Extract data from the newly resolved intent
  switch (intent.type) {
    case "sendPaymentRequest": {
      // Same cross-unit hard-stop as the EXECUTE arm (BTC-04) — a BIP-321
      // creq option carries its unit just like a standalone scan.
      const requestUnit = (intent.info.unit ?? "sat").trim().toLowerCase();
      const activeUnit = (currentCtx.unit ?? "sat").trim().toLowerCase();
      if (requestUnit !== activeUnit) {
        logger.warn("transitions.optionChosen.paymentRequestUnitMismatch", {
          requestUnit,
          activeUnit,
        });
        return {
          step: "error",
          context: ctx,
          data: {
            code: "UNSUPPORTED_PAYMENT_METHOD" as const,
            message: `This payment request is denominated in ${requestUnit}, but your wallet is using ${activeUnit}. Switch your wallet unit to ${requestUnit} to pay it.`,
          },
        };
      }
      ctx.paymentRequest = intent.option.value;
      ctx.supportedMintUrls =
        intent.info.mints.length > 0 ? intent.info.mints : undefined;
      if (isValidSatAmount(intent.info.amount)) {
        ctx.amount = intent.info.amount;
      } else if (intent.info.amount != null) {
        logger.warn("transitions.optionChosen.invalidAmount", {
          source: "sendPaymentRequest",
          amount: intent.info.amount,
        });
      }
      break;
    }
    case "meltLightningInvoice":
      ctx.meltTarget = intent.option.value;
      if (isValidSatAmount(intent.option.amount)) {
        seedScannedSatAmount(
          ctx,
          intent.option.amount,
          "meltLightningInvoice",
          getSatsPerUnitMinor,
        );
      } else if (intent.option.amount != null) {
        logger.warn("transitions.optionChosen.invalidAmount", {
          source: "meltLightningInvoice",
          amount: intent.option.amount,
        });
      }
      break;
    case "meltLightningAddress":
    case "meltLnurlp":
      ctx.meltTarget = intent.option.value;
      break;
    case "meltBolt12Offer":
      ctx.destination = "meltQuote";
      ctx.meltQuoteMethod = "bolt12";
      ctx.meltTarget = intent.option.value;
      if (isValidSatAmount(intent.option.amount)) {
        seedScannedSatAmount(
          ctx,
          intent.option.amount,
          "meltBolt12Offer",
          getSatsPerUnitMinor,
        );
      }
      break;
    case "meltOnchainAddress":
      ctx.destination = "meltQuote";
      ctx.meltQuoteMethod = "onchain";
      ctx.meltTarget = intent.option.value;
      if (isValidSatAmount(intent.option.amount)) {
        seedScannedSatAmount(
          ctx,
          intent.option.amount,
          "meltOnchainAddress",
          getSatsPerUnitMinor,
        );
      }
      break;
  }

  return apply(resolveNext(intent, ctx, walletCtx), ctx);
}

function handleAmountEntered(
  event: FlowEvent & { type: "AMOUNT_ENTERED" },
  currentCtx: FlowContext,
  walletCtx: WalletContext,
  enableEcashSendMemo: boolean,
): TransitionResult {
  logger.info("transitions.amountEntered", {
    amount: event.amount,
    unit: event.unit ?? null,
    ...mintUrlFields(event.mintUrl),
    destination: event.destination ?? currentCtx.destination,
  });
  // The amount screen resolves in the active unit, so a mismatch means a
  // stale draft crossed a unit switch. Reject rather than book a usd amount
  // into a sat flow (or vice versa).
  if (event.unit && event.unit !== currentCtx.unit) {
    logger.warn("transitions.amountEntered.unitMismatch", {
      eventUnit: event.unit,
      ctxUnit: currentCtx.unit,
      amount: event.amount,
    });
    return {
      step: "enterAmount",
      context: currentCtx,
      data: {
        unit: currentCtx.unit,
        constraints: {
          // Rebuild the FULL constraint set (BTC-12): dropping
          // supportedMintUrls / paymentRequest / methodContext here lost a
          // payment-request flow's mint allow-list (and more) on the retry.
          destination: event.destination ?? currentCtx.destination ?? "sendEcash",
          ...(currentCtx.supportedMintUrls
            ? { supportedMintUrls: currentCtx.supportedMintUrls }
            : {}),
          ...(currentCtx.paymentRequest
            ? { paymentRequest: currentCtx.paymentRequest }
            : {}),
          meltTarget: currentCtx.meltTarget,
          recipientPubkey: currentCtx.recipientPubkey,
          recipientProfile: currentCtx.recipientProfile,
          p2pkLockPubkey: currentCtx.p2pkLockPubkey,
          methodContext: createAmountEntryMethodContext(walletCtx),
          ...(currentCtx.entrySource
            ? { entrySource: currentCtx.entrySource }
            : {}),
        },
      },
    };
  }
  const shouldResetContext =
    !!event.destination && event.destination !== currentCtx.destination;
  const ctx: FlowContext = shouldResetContext
    ? {
        unit: currentCtx.unit,
        amount: event.amount,
        mintUrl: event.mintUrl,
        destination: event.destination,
        mintQuoteMethod: event.mintQuoteMethod,
        meltQuoteMethod: event.meltQuoteMethod,
        offline: event.offline,
        meltTarget: event.meltTarget,
        recipientPubkey: event.recipientPubkey,
        recipientProfile: event.recipientProfile,
        amountEntryDisplay: event.amountEntryDisplay,
        memo: undefined,
        sendMemoHandled: false,
      }
    : {
        ...currentCtx,
        amount: event.amount,
        mintUrl: event.mintUrl || currentCtx.mintUrl,
        destination: event.destination ?? currentCtx.destination,
        mintQuoteMethod: event.mintQuoteMethod ?? currentCtx.mintQuoteMethod,
        meltQuoteMethod: event.meltQuoteMethod ?? currentCtx.meltQuoteMethod,
        offline: event.offline ?? currentCtx.offline,
        meltTarget: event.meltTarget ?? currentCtx.meltTarget,
        recipientPubkey: event.recipientPubkey ?? currentCtx.recipientPubkey,
        recipientProfile: event.recipientProfile ?? currentCtx.recipientProfile,
        amountEntryDisplay:
          event.amountEntryDisplay ?? currentCtx.amountEntryDisplay,
        memo: undefined,
        sendMemoHandled: false,
      };

  if (!ctx.intent) {
    const destination = ctx.destination ?? "sendEcash";
    ctx.destination = destination;
    return resolveFromContext(ctx, walletCtx, enableEcashSendMemo);
  }

  return apply(
    resolveNext(ctx.intent, ctx, walletCtx, enableEcashSendMemo),
    ctx,
  );
}

function handleMintSelected(
  event: FlowEvent & { type: "MINT_SELECTED" },
  currentCtx: FlowContext,
  walletCtx: WalletContext,
  enableEcashSendMemo: boolean,
): TransitionResult {
  logger.info("transitions.mintSelected", {
    ...mintUrlFields(event.mintUrl),
    amount: event.amount,
    destination: event.destination ?? currentCtx.destination,
    scope: event.scope,
  });

  // A persist-only-scoped selection only sets which mint backs the npub.cash
  // address ('npc') or a receive rail's standing quote ('bolt12'/'onchain').
  // The wallet persists it via `onNpcMintChanged` / `onReceiveMethodMintChanged`
  // — it must never advance a receive/send flow. Guarding here keeps the
  // invariant even if a stale `destination` (e.g. from a backed-out Fixed
  // Amount flow) is still in context, which would otherwise reopen the
  // amount selector.
  if (
    event.scope === "npc" ||
    event.scope === "bolt12" ||
    event.scope === "onchain"
  ) {
    return {
      step: "dismiss",
      context: { unit: currentCtx.unit, mintUrl: event.mintUrl },
      data: {} as any,
    };
  }

  const shouldResetContext =
    !!event.destination && event.destination !== currentCtx.destination;
  const ctx: FlowContext = shouldResetContext
    ? {
        unit: currentCtx.unit,
        mintUrl: event.mintUrl,
        amount: event.amount,
        destination: event.destination,
        mintQuoteMethod: currentCtx.mintQuoteMethod,
        meltQuoteMethod: currentCtx.meltQuoteMethod,
        paymentRequest: currentCtx.paymentRequest,
        meltTarget: currentCtx.meltTarget,
        recipientPubkey: currentCtx.recipientPubkey,
        recipientProfile: currentCtx.recipientProfile,
        amountEntryDisplay: currentCtx.amountEntryDisplay,
      }
    : {
        ...currentCtx,
        mintUrl: event.mintUrl,
        amount: event.amount ?? currentCtx.amount,
        destination: event.destination ?? currentCtx.destination,
      };

  if (!ctx.intent && !ctx.destination) {
    // Persist-only (e.g. home screen): dismiss the current screen
    return { step: "dismiss", context: ctx, data: {} as any };
  }

  if (!ctx.intent) {
    ctx.destination = ctx.destination ?? "sendEcash";
    return resolveFromContext(ctx, walletCtx, enableEcashSendMemo);
  }

  return apply(
    resolveNext(ctx.intent, ctx, walletCtx, enableEcashSendMemo),
    ctx,
  );
}

function handleProofsChosen(
  event: FlowEvent & { type: "PROOFS_CHOSEN" },
  currentCtx: FlowContext,
  walletCtx: WalletContext,
  enableEcashSendMemo: boolean,
): TransitionResult {
  const destination = currentCtx.destination ?? "sendEcash";
  const proofAmounts = currentCtx.mintUrl
    ? (walletCtx.proofAmounts[currentCtx.mintUrl] ?? [])
    : [];
  // P2PK-locked sends require a mint swap — local proofs can never satisfy a
  // lock, so locked flows must not take the local-proof shortcut.
  const canSendLocally =
    destination === "sendEcash" &&
    !currentCtx.p2pkLockPubkey &&
    buildProofSuggestions(proofAmounts, event.amount).exactMatch;
  const ctx: FlowContext = {
    ...currentCtx,
    amount: event.amount,
    localProofSend: canSendLocally ? true : currentCtx.localProofSend,
  };

  // After proof selection, go straight to terminal — proofs are already
  // validated and we must not re-enter resolveFromContext (which would
  // re-check proof composition and loop back to chooseProofs when offline).
  const mintUrl = ctx.mintUrl!;

  if (destination === "paymentRequest" && ctx.paymentRequest) {
    return {
      step: "navigateToPaymentRequest",
      context: ctx,
      data: {
        mintUrl,
        paymentRequest: ctx.paymentRequest,
        unit: ctx.unit,
        amount: event.amount,
        recipientPubkey: ctx.recipientPubkey,
        recipientProfile: ctx.recipientProfile,
      },
    };
  }

  if (destination === "meltQuote" && ctx.meltTarget) {
    return {
      step: "navigateToMeltPreview",
      context: ctx,
      data: {
        mintUrl,
        meltTarget: ctx.meltTarget,
        unit: ctx.unit,
        amount: event.amount,
        recipientPubkey: ctx.recipientPubkey,
        recipientProfile: ctx.recipientProfile,
      },
    };
  }

  if (
    destination === "sendEcash" &&
    enableEcashSendMemo &&
    !ctx.sendMemoHandled
  ) {
    return {
      step: "enterSendMemo",
      context: ctx,
      data: { mintUrl, amount: event.amount, unit: ctx.unit, memo: ctx.memo },
    };
  }

  return {
    step: "confirmSend",
    context: ctx,
    data: { mintUrl, amount: event.amount, memo: ctx.memo },
  };
}

function handleSendMemoSubmitted(
  event: FlowEvent & { type: "SEND_MEMO_SUBMITTED" },
  currentCtx: FlowContext,
): TransitionResult {
  const mintUrl = currentCtx.mintUrl;
  const amount = currentCtx.amount;
  if (!mintUrl || typeof amount !== "number" || amount <= 0) {
    return {
      step: "error",
      context: currentCtx,
      data: {
        code: "SEND_FAILED",
        message: "Cannot create token without a mint and amount",
      },
    };
  }

  const trimmed = typeof event.memo === "string" ? event.memo.trim() : "";
  const ctx: FlowContext = {
    ...currentCtx,
    memo: trimmed.length > 0 ? trimmed : undefined,
    sendMemoHandled: true,
  };

  return {
    step: "confirmSend",
    context: ctx,
    data: {
      mintUrl,
      amount,
      ...(ctx.memo ? { memo: ctx.memo } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Main transition dispatcher
// ---------------------------------------------------------------------------

export function transition(
  currentStep: FlowStep,
  currentCtx: FlowContext,
  event: FlowEvent,
  detectors: Detectors,
  walletCtx: WalletContext,
  unit: string,
  /** Current offline status from the provider. Stamped onto every result
   *  context so that proof-composition checks always see the real-time
   *  value — even when a handler creates a fresh FlowContext. */
  offline?: boolean,
  enableEcashSendMemo = false,
  /** See `CreateMachineConfig.getSatsPerUnitMinor` — re-denominates scanned
   *  fixed sat amounts into the active unit at seeding time. */
  getSatsPerUnitMinor?: (unit: string) => number | null,
): TransitionResult {
  function stamp(result: TransitionResult): TransitionResult {
    if (offline != null) result.context.offline = offline;
    return result;
  }

  // Global events: work from any state
  switch (event.type) {
    case "EXECUTE":
      return stamp(
        handleExecute(
          event.input,
          detectors,
          walletCtx,
          unit,
          offline,
          getSatsPerUnitMinor,
        ),
      );
    case "RESET":
      return stamp({ step: "idle", context: { unit }, data: {} as any });
    case "REQUEST_MINT_SELECTOR":
      return stamp(requestMintSelector(event, currentCtx, walletCtx));
    case "START_SEND_ECASH":
      logger.info("transitions.startSendEcash", {
        unit,
        offline: offline ?? false,
        hasMeltTarget: !!event.meltTarget,
        recipientPubkeyPresent: !!event.recipientPubkey,
        recipientProfilePresent: !!event.recipientProfile,
        p2pkLockPubkeyPresent: !!event.p2pkLockPubkey,
      });
      return stamp(
        startSendEcashFlow(walletCtx, unit, {
          offline,
          ...(event.meltTarget ? { meltTarget: event.meltTarget } : {}),
          ...(event.recipientPubkey
            ? { recipientPubkey: event.recipientPubkey }
            : {}),
          ...(event.recipientProfile
            ? { recipientProfile: event.recipientProfile }
            : {}),
          ...(event.p2pkLockPubkey
            ? { p2pkLockPubkey: event.p2pkLockPubkey }
            : {}),
          ...(event.allowedMints ? { allowedMints: event.allowedMints } : {}),
          ...(event.entrySource ? { entrySource: event.entrySource } : {}),
        }),
      );
    case "START_SEND":
      return stamp(startSendFlow(unit));
    case "START_RECEIVE_LIGHTNING":
      const receiveLightning = startReceiveLightningFlow(walletCtx, unit);
      logger.info("transitions.startReceiveLightning", {
        unit,
        ...mintUrlFields(receiveLightning.context.mintUrl),
      });
      return stamp(receiveLightning);
    case "START_RECEIVE":
      return stamp(startReceiveFlow(walletCtx, unit));
    case "SHOW_RECEIVE_QR":
      return stamp(startReceiveQrFlow(walletCtx, unit));
    case "REVIEW_MINT":
      return stamp({
        step: "reviewMint",
        context: { ...currentCtx, reviewToken: event.token },
        data: { mintUrl: event.mintUrl, token: event.token },
      });
    case "MINT_TRUSTED": {
      const token = currentCtx.reviewToken;
      if (token) {
        return stamp({
          step: "receiveToken",
          context: { ...currentCtx, reviewToken: undefined },
          data: { token },
        });
      }
      return stamp({ step: currentStep, context: currentCtx, data: {} as any });
    }
  }

  // State-specific events
  switch (event.type) {
    case "OPTION_CHOSEN":
      return stamp(
        handleOptionChosen(
          event,
          currentCtx,
          detectors,
          walletCtx,
          getSatsPerUnitMinor,
        ),
      );
    case "AMOUNT_ENTERED":
      return stamp(
        handleAmountEntered(event, currentCtx, walletCtx, enableEcashSendMemo),
      );
    case "MINT_SELECTED":
      return stamp(
        handleMintSelected(event, currentCtx, walletCtx, enableEcashSendMemo),
      );
    case "PROOFS_CHOSEN":
      // Only valid from the machine-rendered proof sheet — accepted from any
      // other step it dereferences a mint/amount the context may not have and
      // supersedes in-flight resolve work (BTC-12).
      if (currentStep !== "chooseProofs") {
        logger.warn("transitions.proofsChosen.wrongStep", {
          currentStep,
          amount: event.amount,
        });
        return stamp({ step: currentStep, context: currentCtx, data: {} as any });
      }
      return stamp(
        handleProofsChosen(event, currentCtx, walletCtx, enableEcashSendMemo),
      );
    case "SEND_MEMO_SUBMITTED":
      // Same gating: only the memo prompt's own step may consume it (BTC-12).
      if (currentStep !== "enterSendMemo") {
        logger.warn("transitions.sendMemoSubmitted.wrongStep", { currentStep });
        return stamp({ step: currentStep, context: currentCtx, data: {} as any });
      }
      return stamp(handleSendMemoSubmitted(event, currentCtx));
  }

  // Unhandled events (e.g. CONFIRM_MELT, CONFIRM_PAYMENT_REQUEST that
  // bypassed their guard in createMachine.ts) — return current state.
  return stamp({ step: currentStep, context: currentCtx, data: {} as any });
}
