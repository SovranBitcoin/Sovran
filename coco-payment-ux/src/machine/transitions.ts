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
  unit: string
): TransitionResult {
  const parsed = parsePaymentInput(input, detectors);
  const intent = resolveIntent(parsed, detectors, walletCtx);

  const ctx: FlowContext = { parsed, intent, unit };

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

  const ctx: FlowContext = { ...currentCtx, parsed: singleParsed, intent };

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
  // When destination is explicitly provided, start fresh to avoid stale context
  const ctx: FlowContext = event.destination
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
  // When destination is explicitly provided, start fresh to avoid stale context
  const ctx: FlowContext = event.destination
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

  if (!ctx.intent) {
    return resolveFromContext(ctx, walletCtx);
  }

  // After proof selection, go straight to terminal (proofs already validated)
  const destination = ctx.destination ?? 'sendEcash';
  const mintUrl = ctx.mintUrl!;

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
  currentCtx: FlowContext,
  walletCtx: WalletContext
): TransitionResult {
  const hadDestination = !!currentCtx.destination;
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
    },
  };
}

// ---------------------------------------------------------------------------
// Flow entry handlers — reset context and resolve first step
// ---------------------------------------------------------------------------

function handleStartSendEcash(walletCtx: WalletContext, unit: string): TransitionResult {
  const ctx: FlowContext = { unit, destination: 'sendEcash' };
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
        data: { code: 'NO_BALANCE', message: selection.reason },
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
    if (mintUrl) {
      const proofAmounts = walletCtx.proofAmounts[mintUrl] ?? [];
      if (proofAmounts.length > 0) {
        const composition = composeSatoshis(proofAmounts, amount);
        if (!composition.exactMatch) {
          return {
            step: 'chooseProofs',
            context: { ...ctx, destination },
            data: {
              mintUrl,
              amount,
              unit,
              paymentRequest: ctx.paymentRequest,
              meltTarget: ctx.meltTarget,
              proofAmounts,
              suggestions: {
                roundDown:
                  composition.nearestLower != null ? { amount: composition.nearestLower } : null,
                roundUp:
                  composition.nearestUpper != null ? { amount: composition.nearestUpper } : null,
              },
            },
          };
        }
      }
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
    const proofAmounts = walletCtx.proofAmounts[mintUrl] ?? [];
    if (proofAmounts.length > 0) {
      const composition = composeSatoshis(proofAmounts, amount);
      const forceOffline =
        ctx.offline && (destination === 'sendEcash' || destination === 'paymentRequest');
      if (!composition.exactMatch || forceOffline) {
        return {
          step: 'chooseProofs',
          context: { ...ctx, destination },
          data: {
            mintUrl,
            amount,
            unit,
            paymentRequest: ctx.paymentRequest,
            meltTarget: ctx.meltTarget,
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
  unit: string
): TransitionResult {
  // Global events: work from any state
  switch (event.type) {
    case 'EXECUTE':
      return handleExecute(event.input, detectors, walletCtx, unit);
    case 'RESET':
      return { step: 'idle', context: { unit }, data: {} as any };
    case 'REQUEST_MINT_SELECTOR':
      return handleMintSelectorRequested(currentCtx, walletCtx);
    case 'START_SEND_ECASH':
      return handleStartSendEcash(walletCtx, unit);
    case 'START_RECEIVE_LIGHTNING':
      return handleStartReceiveLightning(walletCtx, unit);
  }

  // State-specific events
  switch (event.type) {
    case 'OPTION_CHOSEN':
      return handleOptionChosen(event, currentCtx, detectors, walletCtx);
    case 'AMOUNT_ENTERED':
      return handleAmountEntered(event, currentCtx, walletCtx);
    case 'MINT_SELECTED':
      return handleMintSelected(event, currentCtx, walletCtx);
    case 'PROOFS_CHOSEN':
      return handleProofsChosen(event, currentCtx, walletCtx);
  }
}
