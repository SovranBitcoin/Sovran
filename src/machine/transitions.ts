import { resolveIntent } from '../intent';
import { logger } from '../logger';
import { parsePaymentInput } from '../parse';
import { selectMint, getValidMintCandidates } from '../mint-selection';
import { isValidSatAmount } from '../guards';
import {
  buildMethodAwareMintCandidates,
  createAmountEntryMethodContext,
  getCapabilityUnavailableReason,
  getMintMethodCapability,
} from '../mint-capabilities';
import type { Detectors, MintCandidate, MintMethodRequirement, WalletContext } from '../types';
import { resolveNext, toMintError, type StepResult } from './resolveNext';
import {
  buildChooseAmountFallback,
  buildChooseProofsData,
  buildProofSuggestions,
  findFullAmountCandidates,
} from './amountFallback';
import type { Destination, FlowContext, FlowEvent, FlowStep, RecipientProfile } from './types';

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

function needsSpendableBalance(destination: Destination): boolean {
  return destination !== 'mintQuote';
}

function methodRequirementForDestination(
  destination: Destination,
  ctx: FlowContext,
  unit: string
): MintMethodRequirement | null {
  if (destination === 'mintQuote') {
    return { operation: 'mint', method: ctx.mintQuoteMethod ?? 'bolt11', unit };
  }
  if (destination === 'meltQuote') {
    return { operation: 'melt', method: ctx.meltQuoteMethod ?? 'bolt11', unit };
  }
  return null;
}

function buildMethodCandidates(
  walletCtx: WalletContext,
  requirement: MintMethodRequirement,
  amount: number | undefined,
  allowedMints: string[] | undefined,
  destination: Destination
): MintCandidate[] {
  return buildMethodAwareMintCandidates(walletCtx, requirement, {
    amount,
    allowedMints,
    requireBalance: needsSpendableBalance(destination),
  });
}

function hideMethodUnsupportedCandidates(candidates: MintCandidate[]): MintCandidate[] {
  return candidates.filter((candidate) => {
    const code = candidate.reason?.code;
    return code !== 'MINT_METHOD_DISABLED' && code !== 'MINT_METHOD_UNSUPPORTED';
  });
}

function hasOnlyBalanceFailures(candidates: MintCandidate[]): boolean {
  return (
    candidates.length > 0 &&
    candidates.every((candidate) => {
      const code = candidate.reason?.code;
      return code === 'INSUFFICIENT_BALANCE' || code === 'NO_BALANCE';
    })
  );
}

function isMintValidForFlow(
  mintUrl: string,
  walletCtx: WalletContext,
  amount: number | undefined,
  supportedMintUrls: string[] | undefined,
  destination: Destination,
  ctx: FlowContext
): boolean {
  if (!walletCtx.trustedMintUrls.includes(mintUrl)) return false;
  if (supportedMintUrls?.length && !supportedMintUrls.includes(mintUrl)) return false;
  const requirement = methodRequirementForDestination(destination, ctx, ctx.unit);
  if (requirement) {
    const capability = getMintMethodCapability(walletCtx, mintUrl, requirement);
    if (getCapabilityUnavailableReason(capability, requirement, amount) != null) return false;
  }
  if (!needsSpendableBalance(destination)) return true;
  const balance = walletCtx.mintBalances[mintUrl] ?? 0;
  if (amount != null && amount > 0) return balance >= amount;
  return balance > 0;
}

function buildSelectMintRedirect(
  ctx: FlowContext,
  destination: Destination,
  candidates: MintCandidate[],
  amount: number | undefined
): TransitionResult {
  const requirement = methodRequirementForDestination(destination, ctx, ctx.unit);
  const finalCandidates =
    destination === 'mintQuote' && requirement
      ? hideMethodUnsupportedCandidates(candidates)
      : candidates;

  return {
    step: 'selectMint',
    context: { ...ctx, destination },
    data: {
      candidates: finalCandidates,
      supportedMintUrls: ctx.supportedMintUrls,
      amount,
      unit: ctx.unit,
      paymentRequest: ctx.paymentRequest,
      meltTarget: ctx.meltTarget,
      recipientPubkey: ctx.recipientPubkey,
      recipientProfile: ctx.recipientProfile,
      destination,
      mintQuoteMethod: ctx.mintQuoteMethod,
      meltQuoteMethod: ctx.meltQuoteMethod,
      methodRequirement: requirement ?? undefined,
    },
  };
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
  walletCtx: WalletContext
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
    return resolveFromContext(ctx, walletCtx);
  }

  return apply(resolveNext(ctx.intent, ctx, walletCtx), ctx);
}

function handleProofsChosen(
  event: FlowEvent & { type: 'PROOFS_CHOSEN' },
  currentCtx: FlowContext,
  walletCtx: WalletContext
): TransitionResult {
  const destination = currentCtx.destination ?? 'sendEcash';
  const proofAmounts = currentCtx.mintUrl ? (walletCtx.proofAmounts[currentCtx.mintUrl] ?? []) : [];
  const canSendLocally =
    destination === 'sendEcash' && buildProofSuggestions(proofAmounts, event.amount).exactMatch;
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
  const requirement = ctx.destination
    ? methodRequirementForDestination(ctx.destination, ctx, ctx.unit)
    : null;
  const methodCandidates = requirement
    ? buildMethodCandidates(walletCtx, requirement, amount, ctx.supportedMintUrls, ctx.destination!)
    : null;
  const candidates = getValidMintCandidates(walletCtx, { minAmount: amount });

  // Balance filtering only applies in send-type flows (melt/send/payment request).
  // All other cases (no destination, mintQuote, scope override) show every trusted mint.
  const allTrustedCandidates = walletCtx.trustedMintUrls.map((mintUrl) => ({
    mintUrl,
    balance: walletCtx.mintBalances[mintUrl] ?? 0,
  }));
  const needsBalanceFilter =
    ctx.destination === 'paymentRequest' ||
    ctx.destination === 'meltQuote' ||
    ctx.destination === 'sendEcash';
  const skipBalanceFilter =
    !needsBalanceFilter || event.scope === 'selected' || event.scope === 'npc';
  const finalCandidates = methodCandidates
    ? hideMethodUnsupportedCandidates(methodCandidates)
    : skipBalanceFilter
      ? allTrustedCandidates
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
      mintQuoteMethod: ctx.mintQuoteMethod,
      meltQuoteMethod: ctx.meltQuoteMethod,
      methodRequirement: requirement ?? undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Flow entry handlers — reset context and resolve first step
// ---------------------------------------------------------------------------

function handleStartSendEcash(
  walletCtx: WalletContext,
  unit: string,
  offline?: boolean,
  opts?: { meltTarget?: string; recipientPubkey?: string; recipientProfile?: RecipientProfile }
): TransitionResult {
  logger.info('transitions.startSendEcash', {
    unit,
    offline: offline ?? false,
    hasMeltTarget: !!opts?.meltTarget,
    recipientPubkeyPresent: !!opts?.recipientPubkey,
    recipientProfilePresent: !!opts?.recipientProfile,
  });
  const ctx: FlowContext = {
    unit,
    destination: 'sendEcash',
    offline,
    ...(opts?.meltTarget ? { meltTarget: opts.meltTarget } : {}),
    ...(opts?.recipientPubkey ? { recipientPubkey: opts.recipientPubkey } : {}),
    ...(opts?.recipientProfile ? { recipientProfile: opts.recipientProfile } : {}),
  };
  const selection = selectMint(walletCtx);
  logger.info('transitions.mintSelection.result', {
    selectionType: selection.type,
    mintUrl: selection.type === 'selected' ? selection.mintUrl : null,
  });

  switch (selection.type) {
    case 'selected':
      ctx.mintUrl = selection.mintUrl;
      return {
        step: 'enterAmount',
        context: ctx,
        data: {
          unit,
          preselectedMintUrl: selection.mintUrl,
          constraints: {
            destination: 'sendEcash',
            methodContext: createAmountEntryMethodContext(walletCtx),
            ...(opts?.meltTarget ? { meltTarget: opts.meltTarget } : {}),
            ...(opts?.recipientPubkey ? { recipientPubkey: opts.recipientPubkey } : {}),
            ...(opts?.recipientProfile ? { recipientProfile: opts.recipientProfile } : {}),
          },
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
          ...(opts?.meltTarget ? { meltTarget: opts.meltTarget } : {}),
          ...(opts?.recipientPubkey ? { recipientPubkey: opts.recipientPubkey } : {}),
          ...(opts?.recipientProfile ? { recipientProfile: opts.recipientProfile } : {}),
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
  const requirement: MintMethodRequirement = { operation: 'mint', method: 'bolt11', unit };
  const candidates = buildMethodAwareMintCandidates(walletCtx, requirement);
  const preferred = walletCtx.preferredMintUrl;
  const mintUrl =
    (preferred &&
    candidates.find((candidate) => candidate.mintUrl === preferred)?.status !== 'disabled'
      ? preferred
      : candidates.find((candidate) => candidate.status !== 'disabled')?.mintUrl) ?? '';
  logger.info('transitions.startReceiveLightning', { unit, mintUrl: mintUrl || null });
  const ctx: FlowContext = { unit, destination: 'mintQuote', mintUrl, mintQuoteMethod: 'bolt11' };

  return {
    step: 'enterAmount',
    context: ctx,
    data: {
      unit,
      preselectedMintUrl: mintUrl || undefined,
      constraints: {
        destination: 'mintQuote',
        methodContext: createAmountEntryMethodContext(walletCtx),
      },
    },
  };
}

function handleStartReceive(walletCtx: WalletContext, unit: string): TransitionResult {
  return {
    step: 'navigateToReceive',
    context: { unit },
    data: { unit, methodContext: createAmountEntryMethodContext(walletCtx) },
  };
}

/**
 * Re-validate the current mint against an entered amount for send/melt-style
 * flows. Mirrors the selection logic in resolveNext for the QR-driven path so
 * the Send Money → enter-amount path doesn't silently advance with an
 * insufficient-balance mint.
 *
 * Returns either the mint to use (the preferred one when it still fits, or a
 * substitute auto-picked by `selectMint`) or a redirect TransitionResult that
 * should be returned immediately (mint selector / error).
 */
type RevalidateResult =
  | { kind: 'ok'; mintUrl: string }
  | { kind: 'redirect'; result: TransitionResult };

function revalidateMintForAmount(
  ctx: FlowContext,
  walletCtx: WalletContext,
  destination: Destination,
  amount: number
): RevalidateResult {
  // If the user already picked a mint (or had it preselected) and it still
  // holds enough balance under the current constraints, keep it — don't
  // re-prompt. Only fall through to mint selection when the chosen mint is
  // no longer viable for the entered amount.
  const currentMint = ctx.mintUrl;
  const requirement = methodRequirementForDestination(destination, ctx, ctx.unit);
  if (
    currentMint &&
    isMintValidForFlow(currentMint, walletCtx, amount, ctx.supportedMintUrls, destination, ctx)
  ) {
    return { kind: 'ok', mintUrl: currentMint };
  }

  if (requirement) {
    const methodCandidates = buildMethodCandidates(
      walletCtx,
      requirement,
      amount,
      ctx.supportedMintUrls,
      destination
    );
    const availableCandidates = methodCandidates.filter(
      (candidate) => candidate.status !== 'disabled'
    );
    if (availableCandidates.length > 0) {
      if (requirement.method === 'bolt11' && availableCandidates.length === 1 && !currentMint) {
        return { kind: 'ok', mintUrl: availableCandidates[0].mintUrl };
      }
      return {
        kind: 'redirect',
        result: buildSelectMintRedirect(ctx, destination, methodCandidates, amount),
      };
    }

    if (requirement.method === 'bolt11' && hasOnlyBalanceFailures(methodCandidates)) {
      // Preserve the existing balance fallback path for legacy Lightning melts:
      // if the method is supported but the amount is too high, offer nearby
      // proof-composable amounts instead of reporting method incompatibility.
    } else {
      const reason = methodCandidates.find((candidate) => candidate.reason)?.reason;
      return {
        kind: 'redirect',
        result: {
          step: 'error',
          context: { ...ctx, destination },
          data: {
            code: 'NO_VALID_MINT',
            message: reason?.message ?? `No trusted mint supports ${requirement.method}`,
          },
        },
      };
    }
  }

  const selection = selectMint(walletCtx, {
    allowedMints: ctx.supportedMintUrls,
    minAmount: amount,
  });
  const fullAmountCandidates = findFullAmountCandidates(walletCtx, amount, ctx.supportedMintUrls);
  switch (selection.type) {
    case 'selected':
      if (currentMint && selection.mintUrl !== currentMint) {
        return {
          kind: 'redirect',
          result: buildSelectMintRedirect(
            ctx,
            destination,
            fullAmountCandidates.length > 0
              ? fullAmountCandidates
              : [{ mintUrl: selection.mintUrl, balance: selection.balance }],
            amount
          ),
        };
      }
      return { kind: 'ok', mintUrl: selection.mintUrl };
    case 'selectionNeeded':
      return {
        kind: 'redirect',
        result: buildSelectMintRedirect(ctx, destination, selection.validMints, amount),
      };
    case 'noValidMint': {
      const fallback = buildChooseAmountFallback({
        walletCtx,
        ctx: { ...ctx, destination },
        destination,
        amount,
        preferredMintUrl: walletCtx.preferredMintUrl,
      });
      if (fallback) {
        return {
          kind: 'redirect',
          result: {
            step: 'chooseProofs',
            context: { ...ctx, mintUrl: fallback.mintUrl, destination },
            data: buildChooseProofsData({
              mintUrl: fallback.mintUrl,
              amount,
              unit: ctx.unit,
              proofAmounts: fallback.proofAmounts,
              suggestions: fallback.suggestions,
              ctx: { ...ctx, mintUrl: fallback.mintUrl, destination },
            }),
          },
        };
      }
      const err = toMintError(selection.reason);
      return {
        kind: 'redirect',
        result: { step: 'error', context: { ...ctx, destination }, data: err.data },
      };
    }
  }
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
  logger.info('transitions.resolveFromContext', {
    destination,
    amount,
    mintUrl: mintUrl || null,
  });

  if (destination === 'mintQuote') {
    if (amount == null || amount <= 0) {
      return {
        step: 'enterAmount',
        context: { ...ctx, destination },
        data: {
          unit,
          preselectedMintUrl: mintUrl ?? walletCtx.preferredMintUrl,
          constraints: {
            destination,
            methodContext: createAmountEntryMethodContext(walletCtx),
          },
        },
      };
    }
    if (
      mintUrl &&
      isMintValidForFlow(mintUrl, walletCtx, amount, ctx.supportedMintUrls, destination, ctx)
    ) {
      return {
        step: 'createMintQuote',
        context: { ...ctx, destination },
        data: { mintUrl, amount, unit, method: ctx.mintQuoteMethod },
      };
    }

    const requirement = methodRequirementForDestination(destination, ctx, unit);
    const methodCandidates = requirement
      ? buildMethodCandidates(walletCtx, requirement, amount, ctx.supportedMintUrls, destination)
      : null;
    const availableCandidates =
      methodCandidates?.filter((candidate) => candidate.status !== 'disabled') ?? [];
    if (methodCandidates && availableCandidates.length > 0) {
      return buildSelectMintRedirect(ctx, destination, methodCandidates, amount);
    }

    if (!methodCandidates && !mintUrl) {
      const mint = walletCtx.preferredMintUrl;
      if (mint && walletCtx.trustedMintUrls.includes(mint)) {
        return {
          step: 'createMintQuote',
          context: { ...ctx, mintUrl: mint, destination },
          data: { mintUrl: mint, amount, unit, method: ctx.mintQuoteMethod },
        };
      }
    }
    const reason = methodCandidates?.find((candidate) => candidate.reason)?.reason;
    return {
      step: 'error',
      context: { ...ctx, destination },
      data: {
        code: 'NO_VALID_MINT',
        message: reason?.message ?? 'No trusted mint supports this receive method',
      },
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
          constraints: {
            destination,
            meltTarget: ctx.meltTarget,
            methodContext: createAmountEntryMethodContext(walletCtx),
            recipientPubkey: ctx.recipientPubkey,
            recipientProfile: ctx.recipientProfile,
          },
        },
      };
    }
    // Melts attempt the exact amount first. If no mint can cover it while
    // online, revalidation may offer a balance-based round-down amount.
    const revalidated = revalidateMintForAmount(ctx, walletCtx, destination, amount);
    if (revalidated.kind === 'redirect') return revalidated.result;
    return {
      step: 'navigateToMeltPreview',
      context: { ...ctx, mintUrl: revalidated.mintUrl, destination },
      data: {
        mintUrl: revalidated.mintUrl,
        meltTarget: ctx.meltTarget,
        unit,
        amount,
        recipientPubkey: ctx.recipientPubkey,
        recipientProfile: ctx.recipientProfile,
      },
    };
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
          methodContext: createAmountEntryMethodContext(walletCtx),
          recipientPubkey: ctx.recipientPubkey,
          recipientProfile: ctx.recipientProfile,
        },
      },
    };
  }

  const revalidated = revalidateMintForAmount(ctx, walletCtx, destination, amount);
  if (revalidated.kind === 'redirect') return revalidated.result;
  const effectiveMintUrl = revalidated.mintUrl;

  // Only show proof selector for ecash sends — payment requests must
  // always attempt the exact amount.
  if (destination === 'sendEcash') {
    const proofAmounts = walletCtx.proofAmounts[effectiveMintUrl] ?? [];
    if (proofAmounts.length > 0 && ctx.offline) {
      // Online: skip proof selector — the mint handles swaps server-side
      // via executeSend. If executeSend fails, the catch block in
      // createMachine falls back to chooseProofs.
      // Offline: exact proofs continue directly; non-exact proofs ask the
      // user to choose a nearby locally composable amount.
      const built = buildProofSuggestions(proofAmounts, amount);
      if (!built.exactMatch && built.hasSuggestion) {
        return {
          step: 'chooseProofs',
          context: { ...ctx, mintUrl: effectiveMintUrl, destination },
          data: buildChooseProofsData({
            mintUrl: effectiveMintUrl,
            amount,
            unit,
            proofAmounts,
            suggestions: built.suggestions,
            ctx: { ...ctx, mintUrl: effectiveMintUrl, destination },
          }),
        };
      }
    }
  }

  // Terminal step for whichever destination we're heading to.
  if (destination === 'paymentRequest' && ctx.paymentRequest) {
    return {
      step: 'navigateToPaymentRequest',
      context: { ...ctx, mintUrl: effectiveMintUrl, destination },
      data: {
        mintUrl: effectiveMintUrl,
        paymentRequest: ctx.paymentRequest,
        unit,
        amount,
        recipientPubkey: ctx.recipientPubkey,
        recipientProfile: ctx.recipientProfile,
      },
    };
  }
  return {
    step: 'confirmSend',
    context: { ...ctx, mintUrl: effectiveMintUrl, destination },
    data: { mintUrl: effectiveMintUrl, amount },
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
      return stamp(
        handleStartSendEcash(walletCtx, unit, offline, {
          ...(event.meltTarget ? { meltTarget: event.meltTarget } : {}),
          ...(event.recipientPubkey ? { recipientPubkey: event.recipientPubkey } : {}),
          ...(event.recipientProfile ? { recipientProfile: event.recipientProfile } : {}),
        })
      );
    case 'START_RECEIVE_LIGHTNING':
      return stamp(handleStartReceiveLightning(walletCtx, unit));
    case 'START_RECEIVE':
      return stamp(handleStartReceive(walletCtx, unit));
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
