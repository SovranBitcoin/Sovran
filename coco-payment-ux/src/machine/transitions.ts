import { resolveIntent } from '../intent';
import { composeSatoshis } from '../offline';
import { parsePaymentInput } from '../parse';
import { selectMint, getValidMintCandidates } from '../mint-selection';
import type { Detectors, WalletContext } from '../types';
import { resolveNext, type StepResult } from './resolveNext';
import type { FlowContext, FlowEvent, FlowStep } from './types';

// ---------------------------------------------------------------------------
// Transition result — new step + merged context
// ---------------------------------------------------------------------------

export interface TransitionResult {
  step: FlowStep;
  context: FlowContext;
  data: StepResult['data'];
}

function apply(result: StepResult, ctx: FlowContext): TransitionResult {
  const merged = result.contextPatch ? { ...ctx, ...result.contextPatch } : ctx;
  return { step: result.step, context: merged, data: result.data };
}

// ---------------------------------------------------------------------------
// Per-event transition handlers
// ---------------------------------------------------------------------------

function handleExecute(
  input: string,
  detectors: Detectors,
  walletCtx: WalletContext,
  unit: string,
  offline?: boolean
): TransitionResult {
  const parsed = parsePaymentInput(input, detectors);
  const intent = resolveIntent(parsed, detectors, walletCtx);

  const ctx: FlowContext = { parsed, intent, unit, rawInput: input, offline };

  // Extract known data from the intent into context
  switch (intent.type) {
    case 'sendPaymentRequest': {
      ctx.paymentRequest = intent.option.value;
      ctx.supportedMintUrls = intent.info.mints.length > 0 ? intent.info.mints : undefined;
      if (intent.info.amount != null && intent.info.amount > 0) {
        ctx.amount = intent.info.amount;
      }
      if (intent.info.unit) ctx.unit = intent.info.unit;
      break;
    }
    case 'meltLightningInvoice':
      ctx.meltTarget = intent.option.value;
      if (intent.option.amount != null && intent.option.amount > 0) {
        ctx.amount = intent.option.amount;
      }
      break;
    case 'meltLightningAddress':
    case 'meltLnurlp':
      ctx.meltTarget = intent.option.value;
      break;
  }

  return apply(resolveNext(intent, ctx, walletCtx), ctx);
}

function handleOptionChosen(
  option: FlowEvent & { type: 'OPTION_CHOSEN' },
  currentCtx: FlowContext,
  detectors: Detectors,
  walletCtx: WalletContext
): TransitionResult {
  const parsed = currentCtx.parsed;
  if (!parsed) {
    return {
      step: 'error',
      context: currentCtx,
      data: {
        code: 'UNSUPPORTED_INPUT' as const,
        message: 'No parsed input to resolve option from',
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
    supportedMintUrls: undefined,
    paymentRequest: undefined,
    meltTarget: undefined,
  };

  // Extract data from the newly resolved intent
  switch (intent.type) {
    case 'sendPaymentRequest':
      ctx.paymentRequest = intent.option.value;
      ctx.supportedMintUrls = intent.info.mints.length > 0 ? intent.info.mints : undefined;
      if (intent.info.amount != null && intent.info.amount > 0) ctx.amount = intent.info.amount;
      break;
    case 'meltLightningInvoice':
      ctx.meltTarget = intent.option.value;
      if (intent.option.amount != null && intent.option.amount > 0)
        ctx.amount = intent.option.amount;
      break;
    case 'meltLightningAddress':
    case 'meltLnurlp':
      ctx.meltTarget = intent.option.value;
      break;
  }

  return apply(resolveNext(intent, ctx, walletCtx), ctx);
}

function handleAmountEntered(
  event: FlowEvent & { type: 'AMOUNT_ENTERED' },
  currentCtx: FlowContext,
  walletCtx: WalletContext
): TransitionResult {
  const shouldResetContext = !!event.destination && event.destination !== currentCtx.destination;
  const ctx: FlowContext = shouldResetContext
    ? {
        unit: currentCtx.unit,
        amount: event.amount,
        mintUrl: event.mintUrl,
        destination: event.destination,
        offline: event.offline,
      }
    : {
        ...currentCtx,
        amount: event.amount,
        mintUrl: event.mintUrl || currentCtx.mintUrl,
        destination: event.destination ?? currentCtx.destination,
        offline: event.offline ?? currentCtx.offline,
      };

  if (!ctx.intent) {
    const destination = ctx.destination ?? 'sendEcash';
    ctx.destination = destination;
    return resolveFromContext(ctx, walletCtx);
  }

  return apply(resolveNext(ctx.intent, ctx, walletCtx), ctx);
}

function handleMintSelected(
  event: FlowEvent & { type: 'MINT_SELECTED' },
  currentCtx: FlowContext,
  walletCtx: WalletContext
): TransitionResult {
  const shouldResetContext = !!event.destination && event.destination !== currentCtx.destination;
  const ctx: FlowContext = shouldResetContext
    ? {
        unit: currentCtx.unit,
        mintUrl: event.mintUrl,
        amount: event.amount,
        destination: event.destination,
      }
    : {
        ...currentCtx,
        mintUrl: event.mintUrl,
        amount: event.amount ?? currentCtx.amount,
        destination: event.destination ?? currentCtx.destination,
      };

  if (!ctx.intent && !ctx.destination) {
    // Persist-only (e.g. home screen): dismiss the current screen
    return { step: 'dismiss', context: ctx, data: {} as any };
  }

  if (!ctx.intent) {
    ctx.destination = ctx.destination ?? 'sendEcash';
    return resolveFromContext(ctx, walletCtx);
  }

  return apply(resolveNext(ctx.intent, ctx, walletCtx), ctx);
}

function handleProofsChosen(
  event: FlowEvent & { type: 'PROOFS_CHOSEN' },
  currentCtx: FlowContext,
  walletCtx: WalletContext
): TransitionResult {
  const ctx: FlowContext = { ...currentCtx, amount: event.amount };
  const destination = ctx.destination ?? 'sendEcash';

  // After proof selection, go straight to terminal — proofs are already
  // validated and we must not re-enter resolveFromContext (which would
  // re-check proof composition and loop back to chooseProofs when offline).
  const mintUrl = ctx.mintUrl!;

  if (destination === 'paymentRequest' && ctx.paymentRequest) {
    return {
      step: 'navigateToPaymentRequest',
      context: ctx,
      data: { mintUrl, paymentRequest: ctx.paymentRequest, unit: ctx.unit, amount: event.amount },
    };
  }

  if (destination === 'meltQuote' && ctx.meltTarget) {
    return {
      step: 'navigateToMeltPreview',
      context: ctx,
      data: { mintUrl, meltTarget: ctx.meltTarget, unit: ctx.unit, amount: event.amount },
    };
  }

  return {
    step: 'confirmSend',
    context: ctx,
    data: { mintUrl, amount: event.amount },
  };
}

function handleMintSelectorRequested(
  event: FlowEvent & { type: 'REQUEST_MINT_SELECTOR' },
  currentCtx: FlowContext,
  walletCtx: WalletContext
): TransitionResult {
  // When no destination (e.g. home screen), clear stale context
  const ctx = currentCtx.destination ? currentCtx : ({ unit: currentCtx.unit } as FlowContext);

  const amount = ctx.amount;
  const candidates = getValidMintCandidates(walletCtx, { minAmount: amount });

  // For mintQuote, all trusted mints are candidates (no balance requirement)
  const finalCandidates =
    ctx.destination === 'mintQuote'
      ? walletCtx.trustedMintUrls.map((mintUrl) => ({
          mintUrl,
          balance: walletCtx.mintBalances[mintUrl] ?? 0,
        }))
      : candidates;

  return {
    step: 'selectMint',
    context: ctx,
    data: {
      candidates: finalCandidates,
      supportedMintUrls: ctx.supportedMintUrls,
      amount,
      unit: ctx.unit,
      paymentRequest: ctx.paymentRequest,
      meltTarget: ctx.meltTarget,
      destination: ctx.destination,
      scope: event.scope,
    },
  };
}

// ---------------------------------------------------------------------------
// Flow entry handlers — reset context and resolve first step
// ---------------------------------------------------------------------------

function handleStartSendEcash(walletCtx: WalletContext, unit: string, offline?: boolean): TransitionResult {
  const ctx: FlowContext = { unit, destination: 'sendEcash', offline };
  const selection = selectMint(walletCtx);

  switch (selection.type) {
    case 'selected':
      ctx.mintUrl = selection.mintUrl;
      return {
        step: 'enterAmount',
        context: ctx,
        data: {
          unit,
          preselectedMintUrl: selection.mintUrl,
          constraints: { destination: 'sendEcash' },
        },
      };
    case 'selectionNeeded':
      return {
        step: 'selectMint',
        context: ctx,
        data: {
          candidates: selection.validMints,
          unit,
          destination: 'sendEcash',
        },
      };
    case 'noValidMint':
      return {
        step: 'error',
        context: ctx,
        data: { code: 'NO_BALANCE', message: selection.reason.message },
      };
  }
}

function handleStartReceiveLightning(walletCtx: WalletContext, unit: string): TransitionResult {
  const mintUrl = walletCtx.preferredMintUrl ?? walletCtx.trustedMintUrls[0] ?? '';
  const ctx: FlowContext = { unit, destination: 'mintQuote', mintUrl };

  return {
    step: 'enterAmount',
    context: ctx,
    data: {
      unit,
      preselectedMintUrl: mintUrl || undefined,
      constraints: { destination: 'mintQuote' },
    },
  };
}

function handleStartReceive(unit: string): TransitionResult {
  return {
    step: 'navigateToReceive',
    context: { unit },
    data: { unit },
  };
}

/**
 * Resolve from context alone (no intent). Used when events arrive
 * without a prior EXECUTE (e.g. Send/Receive button flows).
 */
function resolveFromContext(ctx: FlowContext, walletCtx: WalletContext): TransitionResult {
  const destination = ctx.destination ?? 'sendEcash';
  const unit = ctx.unit;
  const amount = ctx.amount;
  const mintUrl = ctx.mintUrl;

  if (destination === 'mintQuote') {
    if (amount == null || amount <= 0) {
      return {
        step: 'enterAmount',
        context: { ...ctx, destination },
        data: {
          unit,
          preselectedMintUrl: mintUrl ?? walletCtx.preferredMintUrl,
          constraints: { destination },
        },
      };
    }
    if (!mintUrl) {
      const mint = walletCtx.preferredMintUrl;
      if (mint && walletCtx.trustedMintUrls.includes(mint)) {
        return {
          step: 'createMintQuote',
          context: { ...ctx, mintUrl: mint, destination },
          data: { mintUrl: mint, amount, unit },
        };
      }
    }
    return {
      step: 'createMintQuote',
      context: { ...ctx, destination },
      data: { mintUrl: mintUrl!, amount, unit },
    };
  }

  if (destination === 'meltQuote') {
    if (!ctx.meltTarget) {
      return {
        step: 'error',
        context: ctx,
        data: { code: 'MISSING_MELT_TARGET', message: 'Missing melt target for melt quote flow' },
      };
    }
    if (amount == null || amount <= 0) {
      return {
        step: 'enterAmount',
        context: { ...ctx, destination },
        data: {
          unit,
          preselectedMintUrl: mintUrl ?? walletCtx.preferredMintUrl,
          constraints: { destination, meltTarget: ctx.meltTarget },
        },
      };
    }
    // Melts always attempt the exact amount — the mint handles the swap
    // server-side. Never show the proof selector for lightning sends.
    if (mintUrl) {
      return {
        step: 'navigateToMeltPreview',
        context: { ...ctx, destination },
        data: { mintUrl, meltTarget: ctx.meltTarget, unit, amount },
      };
    }
  }

  // sendEcash or paymentRequest without intent
  if (amount == null || amount <= 0) {
    return {
      step: 'enterAmount',
      context: { ...ctx, destination },
      data: {
        unit,
        preselectedMintUrl: mintUrl ?? walletCtx.preferredMintUrl,
        constraints: {
          destination,
          paymentRequest: ctx.paymentRequest,
          meltTarget: ctx.meltTarget,
        },
      },
    };
  }

  if (mintUrl) {
    // Only show proof selector for ecash sends — payment requests must
    // always attempt the exact amount.
    if (destination === 'sendEcash') {
      const proofAmounts = walletCtx.proofAmounts[mintUrl] ?? [];
      if (proofAmounts.length > 0 && ctx.offline) {
        // Online: skip proof selector — the mint handles swaps server-side
        // via executeSend. If executeSend fails, the catch block in
        // createMachine falls back to chooseProofs.
        // Offline: always show proof selector since the mint is unreachable.
        const composition = composeSatoshis(proofAmounts, amount);
        return {
          step: 'chooseProofs',
          context: { ...ctx, destination },
          data: {
            mintUrl,
            amount,
            unit,
            proofAmounts,
            suggestions: {
              roundDown: composition.exactMatch
                ? { amount }
                : composition.nearestLower != null
                  ? { amount: composition.nearestLower }
                  : null,
              roundUp: composition.exactMatch
                ? null
                : composition.nearestUpper != null
                  ? { amount: composition.nearestUpper }
                  : null,
            },
          },
        };
      }
    }

    // Terminal step for whichever destination we're heading to.
    if (destination === 'paymentRequest' && ctx.paymentRequest) {
      return {
        step: 'navigateToPaymentRequest',
        context: { ...ctx, destination },
        data: { mintUrl, paymentRequest: ctx.paymentRequest, unit, amount },
      };
    }
    return {
      step: 'confirmSend',
      context: { ...ctx, destination },
      data: { mintUrl, amount },
    };
  }

  return {
    step: 'enterAmount',
    context: { ...ctx, destination },
    data: {
      unit,
      constraints: { destination, paymentRequest: ctx.paymentRequest },
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
  offline?: boolean
): TransitionResult {
  function stamp(result: TransitionResult): TransitionResult {
    if (offline != null) result.context.offline = offline;
    return result;
  }

  // Global events: work from any state
  switch (event.type) {
    case 'EXECUTE':
      return stamp(handleExecute(event.input, detectors, walletCtx, unit, offline));
    case 'RESET':
      return stamp({ step: 'idle', context: { unit }, data: {} as any });
    case 'REQUEST_MINT_SELECTOR':
      return stamp(handleMintSelectorRequested(event, currentCtx, walletCtx));
    case 'START_SEND_ECASH':
      return stamp(handleStartSendEcash(walletCtx, unit, offline));
    case 'START_RECEIVE_LIGHTNING':
      return stamp(handleStartReceiveLightning(walletCtx, unit));
    case 'START_RECEIVE':
      return stamp(handleStartReceive(unit));
    case 'REVIEW_MINT':
      return stamp({
        step: 'reviewMint',
        context: { ...currentCtx, reviewToken: event.token },
        data: { mintUrl: event.mintUrl, token: event.token },
      });
    case 'MINT_TRUSTED': {
      const token = currentCtx.reviewToken;
      if (token) {
        return stamp({
          step: 'receiveToken',
          context: { ...currentCtx, reviewToken: undefined },
          data: { token },
        });
      }
      return stamp({ step: currentStep, context: currentCtx, data: {} as any });
    }
  }

  // State-specific events
  switch (event.type) {
    case 'OPTION_CHOSEN':
      return stamp(handleOptionChosen(event, currentCtx, detectors, walletCtx));
    case 'AMOUNT_ENTERED':
      return stamp(handleAmountEntered(event, currentCtx, walletCtx));
    case 'MINT_SELECTED':
      return stamp(handleMintSelected(event, currentCtx, walletCtx));
    case 'PROOFS_CHOSEN':
      return stamp(handleProofsChosen(event, currentCtx, walletCtx));
  }

  // Unhandled events (e.g. CONFIRM_MELT, CONFIRM_PAYMENT_REQUEST that
  // bypassed their guard in createMachine.ts) — return current state.
  return stamp({ step: currentStep, context: currentCtx, data: {} as any });
}
