import { resolveIntent } from '../intent';
import { logger } from '../logger';
import { parsePaymentInput } from '../parse';
import { isValidSatAmount } from '../guards';
import type { Detectors, WalletContext } from '../types';
import { resolveNext, type StepResult } from './resolveNext';
import { buildProofSuggestions } from './amountFallback';
import type { FlowContext, FlowEvent, FlowStep } from './types';
import { startSendEcashFlow } from './flows/send';
import { startReceiveFlow, startReceiveLightningFlow } from './flows/receive';
import { requestMintSelector, resolveFromContext } from './contextResolution';

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
  logger.info('transitions.execute', { parsedType: parsed.type, intentType: intent.type });

  const ctx: FlowContext = { parsed, intent, unit, rawInput: input, offline };

  // Extract known data from the intent into context
  switch (intent.type) {
    case 'sendPaymentRequest': {
      ctx.paymentRequest = intent.option.value;
      ctx.supportedMintUrls = intent.info.mints.length > 0 ? intent.info.mints : undefined;
      if (isValidSatAmount(intent.info.amount)) {
        ctx.amount = intent.info.amount;
      } else if (intent.info.amount != null) {
        logger.warn('transitions.execute.invalidAmount', {
          source: 'sendPaymentRequest',
          amount: intent.info.amount,
        });
      }
      if (intent.info.unit) ctx.unit = intent.info.unit;
      break;
    }
    case 'meltLightningInvoice':
      ctx.meltTarget = intent.option.value;
      if (isValidSatAmount(intent.option.amount)) {
        ctx.amount = intent.option.amount;
      } else if (intent.option.amount != null) {
        logger.warn('transitions.execute.invalidAmount', {
          source: 'meltLightningInvoice',
          amount: intent.option.amount,
        });
      }
      break;
    case 'meltLightningAddress':
    case 'meltLnurlp':
      ctx.meltTarget = intent.option.value;
      break;
    case 'meltOnchainAddress':
      ctx.destination = 'meltQuote';
      ctx.meltQuoteMethod = 'onchain';
      ctx.meltTarget = intent.option.value;
      if (isValidSatAmount(intent.option.amount)) {
        ctx.amount = intent.option.amount;
      }
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
    mintQuoteMethod: undefined,
    meltQuoteMethod: undefined,
    supportedMintUrls: undefined,
    paymentRequest: undefined,
    meltTarget: undefined,
  };

  // Extract data from the newly resolved intent
  switch (intent.type) {
    case 'sendPaymentRequest':
      ctx.paymentRequest = intent.option.value;
      ctx.supportedMintUrls = intent.info.mints.length > 0 ? intent.info.mints : undefined;
      if (isValidSatAmount(intent.info.amount)) {
        ctx.amount = intent.info.amount;
      } else if (intent.info.amount != null) {
        logger.warn('transitions.optionChosen.invalidAmount', {
          source: 'sendPaymentRequest',
          amount: intent.info.amount,
        });
      }
      break;
    case 'meltLightningInvoice':
      ctx.meltTarget = intent.option.value;
      if (isValidSatAmount(intent.option.amount)) {
        ctx.amount = intent.option.amount;
      } else if (intent.option.amount != null) {
        logger.warn('transitions.optionChosen.invalidAmount', {
          source: 'meltLightningInvoice',
          amount: intent.option.amount,
        });
      }
      break;
    case 'meltLightningAddress':
    case 'meltLnurlp':
      ctx.meltTarget = intent.option.value;
      break;
    case 'meltOnchainAddress':
      ctx.destination = 'meltQuote';
      ctx.meltQuoteMethod = 'onchain';
      ctx.meltTarget = intent.option.value;
      if (isValidSatAmount(intent.option.amount)) {
        ctx.amount = intent.option.amount;
      }
      break;
  }

  return apply(resolveNext(intent, ctx, walletCtx), ctx);
}

function handleAmountEntered(
  event: FlowEvent & { type: 'AMOUNT_ENTERED' },
  currentCtx: FlowContext,
  walletCtx: WalletContext,
  enableEcashSendMemo: boolean
): TransitionResult {
  logger.info('transitions.amountEntered', {
    amount: event.amount,
    mintUrl: event.mintUrl || null,
    destination: event.destination ?? currentCtx.destination,
  });
  const shouldResetContext = !!event.destination && event.destination !== currentCtx.destination;
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
        amountEntryDisplay: event.amountEntryDisplay ?? currentCtx.amountEntryDisplay,
        memo: undefined,
        sendMemoHandled: false,
      };

  if (!ctx.intent) {
    const destination = ctx.destination ?? 'sendEcash';
    ctx.destination = destination;
    return resolveFromContext(ctx, walletCtx, enableEcashSendMemo);
  }

  return apply(resolveNext(ctx.intent, ctx, walletCtx, enableEcashSendMemo), ctx);
}

function handleMintSelected(
  event: FlowEvent & { type: 'MINT_SELECTED' },
  currentCtx: FlowContext,
  walletCtx: WalletContext,
  enableEcashSendMemo: boolean
): TransitionResult {
  logger.info('transitions.mintSelected', {
    mintUrl: event.mintUrl,
    amount: event.amount,
    destination: event.destination ?? currentCtx.destination,
  });
  const shouldResetContext = !!event.destination && event.destination !== currentCtx.destination;
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
    return { step: 'dismiss', context: ctx, data: {} as any };
  }

  if (!ctx.intent) {
    ctx.destination = ctx.destination ?? 'sendEcash';
    return resolveFromContext(ctx, walletCtx, enableEcashSendMemo);
  }

  return apply(resolveNext(ctx.intent, ctx, walletCtx, enableEcashSendMemo), ctx);
}

function handleProofsChosen(
  event: FlowEvent & { type: 'PROOFS_CHOSEN' },
  currentCtx: FlowContext,
  walletCtx: WalletContext,
  enableEcashSendMemo: boolean
): TransitionResult {
  const destination = currentCtx.destination ?? 'sendEcash';
  const proofAmounts = currentCtx.mintUrl ? (walletCtx.proofAmounts[currentCtx.mintUrl] ?? []) : [];
  // P2PK-locked sends require a mint swap — local proofs can never satisfy a
  // lock, so locked flows must not take the local-proof shortcut.
  const canSendLocally =
    destination === 'sendEcash' &&
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

  if (destination === 'paymentRequest' && ctx.paymentRequest) {
    return {
      step: 'navigateToPaymentRequest',
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

  if (destination === 'meltQuote' && ctx.meltTarget) {
    return {
      step: 'navigateToMeltPreview',
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

  if (destination === 'sendEcash' && enableEcashSendMemo && !ctx.sendMemoHandled) {
    return {
      step: 'enterSendMemo',
      context: ctx,
      data: { mintUrl, amount: event.amount, unit: ctx.unit, memo: ctx.memo },
    };
  }

  return {
    step: 'confirmSend',
    context: ctx,
    data: { mintUrl, amount: event.amount, memo: ctx.memo },
  };
}

function handleSendMemoSubmitted(
  event: FlowEvent & { type: 'SEND_MEMO_SUBMITTED' },
  currentCtx: FlowContext
): TransitionResult {
  const mintUrl = currentCtx.mintUrl;
  const amount = currentCtx.amount;
  if (!mintUrl || typeof amount !== 'number' || amount <= 0) {
    return {
      step: 'error',
      context: currentCtx,
      data: {
        code: 'SEND_FAILED',
        message: 'Cannot create token without a mint and amount',
      },
    };
  }

  const trimmed = typeof event.memo === 'string' ? event.memo.trim() : '';
  const ctx: FlowContext = {
    ...currentCtx,
    memo: trimmed.length > 0 ? trimmed : undefined,
    sendMemoHandled: true,
  };

  return {
    step: 'confirmSend',
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
  enableEcashSendMemo = false
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
      return stamp(requestMintSelector(event, currentCtx, walletCtx));
    case 'SEND_MEMO_SUBMITTED':
      return stamp(handleSendMemoSubmitted(event, currentCtx));
    case 'START_SEND_ECASH':
      logger.info('transitions.startSendEcash', {
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
          ...(event.recipientPubkey ? { recipientPubkey: event.recipientPubkey } : {}),
          ...(event.recipientProfile ? { recipientProfile: event.recipientProfile } : {}),
          ...(event.p2pkLockPubkey ? { p2pkLockPubkey: event.p2pkLockPubkey } : {}),
        })
      );
    case 'START_RECEIVE_LIGHTNING':
      const receiveLightning = startReceiveLightningFlow(walletCtx, unit);
      logger.info('transitions.startReceiveLightning', {
        unit,
        mintUrl: receiveLightning.context.mintUrl ?? null,
      });
      return stamp(receiveLightning);
    case 'START_RECEIVE':
      return stamp(startReceiveFlow(walletCtx, unit));
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
      return stamp(handleAmountEntered(event, currentCtx, walletCtx, enableEcashSendMemo));
    case 'MINT_SELECTED':
      return stamp(handleMintSelected(event, currentCtx, walletCtx, enableEcashSendMemo));
    case 'PROOFS_CHOSEN':
      return stamp(handleProofsChosen(event, currentCtx, walletCtx, enableEcashSendMemo));
  }

  // Unhandled events (e.g. CONFIRM_MELT, CONFIRM_PAYMENT_REQUEST that
  // bypassed their guard in createMachine.ts) — return current state.
  return stamp({ step: currentStep, context: currentCtx, data: {} as any });
}
