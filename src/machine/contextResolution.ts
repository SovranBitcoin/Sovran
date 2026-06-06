import {
  buildMethodAwareMintCandidates,
  createAmountEntryMethodContext,
  getCapabilityUnavailableReason,
  getMintMethodCapability,
} from '../mint-capabilities';
import { getValidMintCandidates, selectMint } from '../mint-selection';
import type { MintCandidate, MintMethodRequirement, WalletContext } from '../types';
import {
  buildChooseAmountFallback,
  buildChooseProofsData,
  buildProofSuggestions,
  findFullAmountCandidates,
} from './amountFallback';
import { toMintError } from './resolveNext';
import type { Destination, FlowContext, FlowEvent, FlowStep, StepDataMap } from './types';

export interface ContextResolutionResult<S extends FlowStep = FlowStep> {
  step: S;
  context: FlowContext;
  data: StepDataMap[S];
}

function needsSpendableBalance(destination: Destination): boolean {
  return destination !== 'mintQuote';
}

function methodRequirementForDestination(
  destination: Destination,
  ctx: FlowContext,
  unit: string,
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
  destination: Destination,
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
  ctx: FlowContext,
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
  amount: number | undefined,
): ContextResolutionResult<'selectMint'> {
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

type RevalidateResult =
  | { kind: 'ok'; mintUrl: string }
  | { kind: 'redirect'; result: ContextResolutionResult };

function revalidateMintForAmount(
  ctx: FlowContext,
  walletCtx: WalletContext,
  destination: Destination,
  amount: number,
): RevalidateResult {
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
      destination,
    );
    const availableCandidates = methodCandidates.filter(
      (candidate) => candidate.status !== 'disabled',
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
      // If the method is supported but the amount is too high, offer nearby
      // proof amounts instead of reporting method incompatibility.
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
            amount,
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

export function requestMintSelector(
  event: FlowEvent & { type: 'REQUEST_MINT_SELECTOR' },
  currentCtx: FlowContext,
  walletCtx: WalletContext,
): ContextResolutionResult<'selectMint'> {
  const ctx = currentCtx.destination ? currentCtx : ({ unit: currentCtx.unit } as FlowContext);

  const amount = ctx.amount;
  const requirement = ctx.destination
    ? methodRequirementForDestination(ctx.destination, ctx, ctx.unit)
    : null;
  const methodCandidates = requirement
    ? buildMethodCandidates(walletCtx, requirement, amount, ctx.supportedMintUrls, ctx.destination!)
    : null;
  const candidates = getValidMintCandidates(walletCtx, { minAmount: amount });

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

export function resolveFromContext(
  ctx: FlowContext,
  walletCtx: WalletContext,
  enableEcashSendMemo = false,
): ContextResolutionResult {
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

  if (destination === 'sendEcash') {
    const proofAmounts = walletCtx.proofAmounts[effectiveMintUrl] ?? [];
    if (proofAmounts.length > 0 && ctx.offline) {
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
  if (destination === 'sendEcash' && enableEcashSendMemo && !ctx.sendMemoHandled) {
    return {
      step: 'enterSendMemo',
      context: { ...ctx, mintUrl: effectiveMintUrl, destination },
      data: {
        mintUrl: effectiveMintUrl,
        amount,
        unit,
        ...(ctx.memo ? { memo: ctx.memo } : {}),
      },
    };
  }
  return {
    step: 'confirmSend',
    context: { ...ctx, mintUrl: effectiveMintUrl, destination },
    data: { mintUrl: effectiveMintUrl, amount, ...(ctx.memo ? { memo: ctx.memo } : {}) },
  };
}
