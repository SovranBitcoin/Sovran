import type { LocalizedReason } from '../formatting/locales';
import { logger } from '../logger';
import {
  buildMethodAwareMintCandidates,
  createAmountEntryMethodContext,
  getCapabilityUnavailableReason,
  getMintMethodCapability,
  hasMintSupportingMethod,
  isMethodImplemented,
} from '../mint-capabilities';
import { selectMint } from '../mint-selection';
import type { MintCandidate, MintMethodRequirement, ResolvedIntent, WalletContext } from '../types';
import {
  buildChooseAmountFallback,
  buildChooseProofsData,
  buildProofSuggestions,
  findFullAmountCandidates,
} from './amountFallback';
import type { Destination, ErrorCode, FlowContext, FlowStep, StepDataMap } from './types';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface StepResult<S extends FlowStep = FlowStep> {
  step: S;
  data: StepDataMap[S];
  /** Updated context fields to merge (e.g. auto-selected mintUrl). */
  contextPatch?: Partial<FlowContext>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorResult(code: ErrorCode, message: string): StepResult<'error'> {
  return { step: 'error', data: { code, message } };
}

export function toMintError(reason: LocalizedReason): StepResult<'error'> {
  switch (reason.code) {
    case 'INSUFFICIENT_BALANCE':
    case 'INSUFFICIENT_BALANCE_ALLOWED':
      return errorResult('INSUFFICIENT_BALANCE', reason.message);
    case 'NO_BALANCE':
    case 'NO_MINT_SUFFICIENT_BALANCE':
      return errorResult('NO_BALANCE', reason.message);
    default:
      return errorResult('NO_VALID_MINT', reason.message);
  }
}

function getDestination(intent: ResolvedIntent, ctx: FlowContext): Destination {
  if (ctx.destination) return ctx.destination;
  switch (intent.type) {
    case 'sendPaymentRequest':
      return 'paymentRequest';
    case 'meltLightningInvoice':
    case 'meltLightningAddress':
    case 'meltLnurlp':
    case 'meltOnchainAddress':
      return 'meltQuote';
    default:
      return 'sendEcash';
  }
}

function needsAmount(ctx: FlowContext): boolean {
  return ctx.amount == null || ctx.amount <= 0;
}

/**
 * For mintQuote (receive), any trusted mint works -- no balance needed.
 * For send/melt, we need a mint with sufficient balance.
 */
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

function firstMethodError(
  candidates: MintCandidate[],
  fallbackMessage: string
): StepResult<'error'> {
  const reason = candidates.find((candidate) => candidate.reason)?.reason;
  return errorResult('NO_VALID_MINT', reason?.message ?? fallbackMessage);
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

// ---------------------------------------------------------------------------
// Proof composition check
// ---------------------------------------------------------------------------

function checkProofComposition(
  walletCtx: WalletContext,
  mintUrl: string,
  amount: number,
  unit: string,
  ctx: FlowContext
): StepResult<'chooseProofs'> | null {
  // Only show proof selector for ecash sends. Lightning melts and payment
  // requests must always attempt the exact amount — the mint handles the
  // swap server-side, so showing a proof picker is incorrect.
  if (ctx.destination !== 'sendEcash') return null;

  const proofAmounts = walletCtx.proofAmounts[mintUrl] ?? [];
  if (proofAmounts.length === 0) return null;

  // Online: always skip the proof selector — the mint handles swaps
  // server-side via executeSend. If executeSend fails, the catch block
  // in createMachine falls back to chooseProofs.
  if (!ctx.offline) return null;

  const built = buildProofSuggestions(proofAmounts, amount);
  if (built.exactMatch || !built.hasSuggestion) return null;

  return {
    step: 'chooseProofs',
    data: buildChooseProofsData({
      mintUrl,
      amount,
      unit,
      proofAmounts,
      suggestions: built.suggestions,
      ctx,
    }),
  };
}

// ---------------------------------------------------------------------------
// Terminal step builders
// ---------------------------------------------------------------------------

function terminalStep(destination: Destination, ctx: FlowContext): StepResult {
  logger.info('resolveNext.terminal', {
    destination,
    mintUrl: ctx.mintUrl,
    amount: ctx.amount,
  });
  const { mintUrl, amount, unit, meltTarget, recipientPubkey, recipientProfile } = ctx;

  switch (destination) {
    case 'mintQuote':
      return {
        step: 'createMintQuote',
        data: { mintUrl: mintUrl!, amount: amount!, unit, method: ctx.mintQuoteMethod },
      };
    case 'meltQuote':
      return {
        step: 'navigateToMeltPreview',
        data: {
          mintUrl: mintUrl!,
          meltTarget: meltTarget!,
          unit,
          amount: amount!,
          recipientPubkey,
          recipientProfile,
        },
      };
    case 'paymentRequest':
      return {
        step: 'navigateToPaymentRequest',
        data: {
          mintUrl: mintUrl!,
          paymentRequest: ctx.paymentRequest!,
          amount: amount!,
          unit,
          recipientPubkey,
          recipientProfile,
        },
      };
    case 'sendEcash':
      return {
        step: 'confirmSend',
        data: { mintUrl: mintUrl!, amount: amount! },
      };
  }
}

// ---------------------------------------------------------------------------
// resolveNext — the single routing function
// ---------------------------------------------------------------------------

/**
 * Given a resolved intent and accumulated context, determines the next step.
 *
 * Priority order:
 * 1. Terminal intents (receiveToken, openMint, openProfile, ignore)
 * 2. Multi-option (chooseOption)
 * 3. Gather missing info: amount → mint → proofs
 * 4. Terminal step based on destination
 */
export function resolveNext(
  intent: ResolvedIntent,
  ctx: FlowContext,
  walletCtx: WalletContext
): StepResult {
  // --- Terminal intents ---
  if (intent.type === 'receiveToken') {
    return { step: 'receiveToken', data: { token: intent.option.value } };
  }
  if (intent.type === 'openMint') {
    return { step: 'openMint', data: { url: intent.url } };
  }
  if (intent.type === 'openProfile') {
    return { step: 'openProfile', data: { npub: intent.npub } };
  }
  if (intent.type === 'ignore') {
    return errorResult('UNSUPPORTED_INPUT', intent.reason.message);
  }
  if (intent.type === 'meltOnchainAddress') {
    const requirement: MintMethodRequirement = {
      operation: 'melt',
      method: 'onchain',
      unit: ctx.unit,
    };
    if (!hasMintSupportingMethod(walletCtx, requirement)) {
      return errorResult('NO_VALID_MINT', 'No trusted mint supports onchain sending');
    }
    if (!isMethodImplemented(requirement)) {
      return errorResult('UNSUPPORTED_PAYMENT_METHOD', 'Onchain send is not supported yet');
    }
  }

  // --- Multi-option ---
  if (intent.type === 'chooseOption') {
    const hasViable = intent.options.some((o) => o.status !== 'disabled');
    if (!hasViable) {
      return errorResult('ALL_OPTIONS_DISABLED', 'All payment options are disabled');
    }
    return {
      step: 'chooseOption',
      data: { parsed: ctx.parsed!, options: intent.options, unit: ctx.unit },
    };
  }

  // --- Gather phase ---
  const destination = getDestination(intent, ctx);
  const supportedMintUrls = ctx.supportedMintUrls;
  const unit = ctx.unit;
  logger.info('resolveNext.routing', {
    intentType: intent.type,
    destination,
    amount: ctx.amount,
    mintUrl: ctx.mintUrl || null,
  });

  // 1. Need amount?
  if (needsAmount(ctx)) {
    logger.info('resolveNext.enterAmount.amountNeeded');

    const preselectedMintUrl = ctx.mintUrl ?? walletCtx.preferredMintUrl;
    return {
      step: 'enterAmount',
      data: {
        unit,
        preselectedMintUrl,
        constraints: {
          destination,
          supportedMintUrls,
          paymentRequest: ctx.paymentRequest,
          meltTarget: ctx.meltTarget,
          methodContext: createAmountEntryMethodContext(walletCtx),
          // Carry recipient identity onto the amount-entry constraints so the
          // scan-LA flow (EXECUTE → resolveNext → enterAmount) reaches the
          // amount screen with the same fields the chat-launched flow gets
          // via handleStartSendEcash. Without this, the navigation handler's
          // entry serialization loses pubkey/profile and AmountFlowScreen
          // never shows the recipient header on first paint.
          recipientPubkey: ctx.recipientPubkey,
          recipientProfile: ctx.recipientProfile,
        },
      },
      contextPatch: { destination },
    };
  }

  // 2. Need mint?
  const amount = ctx.amount!;

  if (
    ctx.mintUrl &&
    isMintValidForFlow(ctx.mintUrl, walletCtx, amount, supportedMintUrls, destination, ctx)
  ) {
    // Current mint is valid -- skip to proofs/terminal
  } else if (destination === 'mintQuote') {
    const requirement = methodRequirementForDestination(destination, ctx, unit);
    const methodCandidates = requirement
      ? buildMethodCandidates(walletCtx, requirement, amount, supportedMintUrls, destination)
      : null;
    const availableMethodCandidates =
      methodCandidates?.filter((candidate) => candidate.status !== 'disabled') ?? null;

    // For receive, prefer mint or let user pick
    const mint = ctx.mintUrl ?? walletCtx.preferredMintUrl;
    if (
      mint &&
      isMintValidForFlow(mint, walletCtx, amount, supportedMintUrls, destination, ctx)
    ) {
      return resolveWithMint(mint, destination, amount, unit, ctx, walletCtx);
    }
    if (
      !requirement &&
      walletCtx.trustedMintUrls.length === 1
    ) {
      return resolveWithMint(
        walletCtx.trustedMintUrls[0],
        destination,
        amount,
        unit,
        ctx,
        walletCtx
      );
    }
    if (requirement && (!availableMethodCandidates || availableMethodCandidates.length === 0)) {
      return firstMethodError(
        methodCandidates ?? [],
        `No trusted mint supports ${requirement.method} receive`
      );
    }
    const candidates = walletCtx.trustedMintUrls.map((mintUrl) => ({
      mintUrl,
      balance: walletCtx.mintBalances[mintUrl] ?? 0,
    }));
    return {
      step: 'selectMint',
      data: {
        candidates: methodCandidates ?? candidates,
        supportedMintUrls,
        amount,
        unit,
        destination,
        mintQuoteMethod: ctx.mintQuoteMethod,
        methodRequirement: requirement ?? undefined,
      },
      contextPatch: { destination },
    };
  } else {
    // Send/melt: need mint with balance
    const requirement = methodRequirementForDestination(destination, ctx, unit);
    const methodCandidates = requirement
      ? buildMethodCandidates(walletCtx, requirement, amount, supportedMintUrls, destination)
      : null;
    const availableMethodCandidates =
      methodCandidates?.filter((candidate) => candidate.status !== 'disabled') ?? null;
    if (
      requirement &&
      availableMethodCandidates &&
      availableMethodCandidates.length === 0 &&
      (requirement.method !== 'bolt11' || !hasOnlyBalanceFailures(methodCandidates ?? []))
    ) {
      return firstMethodError(
        methodCandidates ?? [],
        `No trusted mint supports ${requirement.method} ${requirement.operation}`
      );
    }
    const fullAmountCandidates = requirement
      ? (availableMethodCandidates ?? [])
      : needsSpendableBalance(destination)
      ? findFullAmountCandidates(walletCtx, amount, supportedMintUrls)
      : [];
    const selection = needsSpendableBalance(destination)
      ? fullAmountCandidates.length === 1 && !ctx.mintUrl
        ? {
            type: 'selected' as const,
            mintUrl: fullAmountCandidates[0].mintUrl,
            balance: fullAmountCandidates[0].balance,
          }
        : fullAmountCandidates.length > 0
          ? { type: 'selectionNeeded' as const, validMints: fullAmountCandidates }
          : selectMint(walletCtx, {
              allowedMints: supportedMintUrls,
              minAmount: amount,
            })
      : selectMint(walletCtx, { allowedMints: supportedMintUrls });

    switch (selection.type) {
      case 'selected':
        return resolveWithMint(selection.mintUrl, destination, amount, unit, ctx, walletCtx);
      case 'selectionNeeded':
        return {
          step: 'selectMint',
          data: {
            candidates: selection.validMints,
            supportedMintUrls,
            amount,
            unit,
            paymentRequest: ctx.paymentRequest,
            meltTarget: ctx.meltTarget,
            recipientPubkey: ctx.recipientPubkey,
            recipientProfile: ctx.recipientProfile,
            destination,
            mintQuoteMethod: ctx.mintQuoteMethod,
            meltQuoteMethod: ctx.meltQuoteMethod,
            methodRequirement: requirement ?? undefined,
          },
          contextPatch: { destination },
        };
      case 'noValidMint':
        if (needsSpendableBalance(destination)) {
          const fallback = buildChooseAmountFallback({
            walletCtx,
            ctx: { ...ctx, destination },
            destination,
            amount,
            preferredMintUrl: walletCtx.preferredMintUrl,
          });
          if (fallback) {
            return {
              step: 'chooseProofs',
              data: buildChooseProofsData({
                mintUrl: fallback.mintUrl,
                amount,
                unit,
                proofAmounts: fallback.proofAmounts,
                suggestions: fallback.suggestions,
                ctx: { ...ctx, destination, mintUrl: fallback.mintUrl },
              }),
              contextPatch: { destination, mintUrl: fallback.mintUrl },
            };
          }
        }
        return toMintError(selection.reason);
    }
  }

  // 3. Mint is valid. Check proof composition (ecash sends only).
  const mintUrl = ctx.mintUrl!;
  const ctxWithDest = ctx.destination === destination ? ctx : { ...ctx, destination };
  if (needsSpendableBalance(destination)) {
    const proofResult = checkProofComposition(walletCtx, mintUrl, amount, unit, ctxWithDest);
    if (proofResult) return { ...proofResult, contextPatch: { destination } };
  }

  // 4. Terminal step
  return { ...terminalStep(destination, ctx), contextPatch: { destination } };
}

/** Internal helper: set mintUrl in context patch and continue to proofs/terminal. */
function resolveWithMint(
  mintUrl: string,
  destination: Destination,
  amount: number,
  unit: string,
  ctx: FlowContext,
  walletCtx: WalletContext
): StepResult {
  const merged = { ...ctx, mintUrl, destination };

  if (needsSpendableBalance(destination)) {
    const proofResult = checkProofComposition(walletCtx, mintUrl, amount, unit, merged);
    if (proofResult) return { ...proofResult, contextPatch: { mintUrl, destination } };
  }

  return {
    ...terminalStep(destination, merged),
    contextPatch: { mintUrl, destination },
  };
}
