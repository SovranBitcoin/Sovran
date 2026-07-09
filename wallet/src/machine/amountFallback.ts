import { composeSatoshis } from '../offline';
import { logger } from '../logger';
import type { MintCandidate, WalletContext } from '../types';
import type { Destination, FlowContext, StepDataMap } from './types';

type Suggestions = NonNullable<StepDataMap['chooseProofs']['suggestions']>;

export interface ChooseAmountFallback {
  mintUrl: string;
  proofAmounts: number[];
  suggestions: Suggestions;
}

interface FallbackMint {
  mintUrl: string;
  balance: number;
  proofAmounts: number[];
}

function mintUrlSummary(
  mintUrl: string | null | undefined,
): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

export function buildProofSuggestions(
  proofAmounts: number[],
  amount: number,
): {
  exactMatch: boolean;
  suggestions: Suggestions;
  hasSuggestion: boolean;
} {
  const composition = composeSatoshis(proofAmounts, amount);
  const roundDown =
    composition.nearestLower != null && composition.nearestLower < amount
      ? { amount: composition.nearestLower }
      : null;
  const roundUp =
    composition.nearestUpper != null && composition.nearestUpper > amount
      ? { amount: composition.nearestUpper }
      : null;

  const result = {
    exactMatch: composition.exactMatch,
    suggestions: { roundDown, roundUp },
    hasSuggestion: roundDown != null || roundUp != null,
  };
  logger.debug('amountFallback.proofSuggestions', {
    amount,
    proofCount: proofAmounts.length,
    exactMatch: result.exactMatch,
    hasRoundDown: !!roundDown,
    hasRoundUp: !!roundUp,
    hasSuggestion: result.hasSuggestion,
  });
  return result;
}

export function buildBalanceSuggestions(
  balance: number,
  amount: number,
): {
  suggestions: Suggestions;
  hasSuggestion: boolean;
} {
  const roundDown =
    balance > 0 && balance < amount ? { amount: balance } : null;
  const result = {
    suggestions: { roundDown, roundUp: null },
    hasSuggestion: roundDown != null,
  };
  logger.debug('amountFallback.balanceSuggestions', {
    balance,
    amount,
    hasRoundDown: !!roundDown,
    hasSuggestion: result.hasSuggestion,
  });
  return result;
}

export function buildChooseProofsData(args: {
  mintUrl: string;
  amount: number;
  unit: string;
  proofAmounts: number[];
  suggestions: Suggestions;
  ctx: FlowContext;
}): StepDataMap['chooseProofs'] {
  logger.info('amountFallback.chooseProofsData', {
    ...mintUrlSummary(args.mintUrl),
    amount: args.amount,
    unit: args.unit,
    proofCount: args.proofAmounts.length,
    hasPaymentRequest: !!args.ctx.paymentRequest,
    paymentRequestLength: args.ctx.paymentRequest?.length,
    hasMeltTarget: !!args.ctx.meltTarget,
    meltTargetLength: args.ctx.meltTarget?.length,
    hasRecipientPubkey: !!args.ctx.recipientPubkey,
    recipientPubkeyLength: args.ctx.recipientPubkey?.length ?? 0,
    hasRecipientProfile: !!args.ctx.recipientProfile,
    hasRoundDown: !!args.suggestions.roundDown,
    hasRoundUp: !!args.suggestions.roundUp,
  });
  return {
    mintUrl: args.mintUrl,
    amount: args.amount,
    unit: args.unit,
    proofAmounts: args.proofAmounts,
    paymentRequest: args.ctx.paymentRequest,
    meltTarget: args.ctx.meltTarget,
    recipientPubkey: args.ctx.recipientPubkey,
    recipientProfile: args.ctx.recipientProfile,
    displayMetadata: args.ctx.amountEntryDisplay,
    suggestions: args.suggestions,
  };
}

export function findFullAmountCandidates(
  walletCtx: WalletContext,
  amount: number,
  allowedMints?: string[],
): MintCandidate[] {
  const allowed = allowedMints?.length ? new Set(allowedMints) : null;
  const candidates = walletCtx.trustedMintUrls
    .map((mintUrl) => ({
      mintUrl,
      balance: walletCtx.mintBalances[mintUrl] ?? 0,
    }))
    .filter((candidate) => {
      if (allowed && !allowed.has(candidate.mintUrl)) return false;
      return candidate.balance >= amount;
    })
    .sort((a, b) => b.balance - a.balance);
  logger.info('amountFallback.fullAmountCandidates', {
    trustedMintCount: walletCtx.trustedMintUrls.length,
    allowedMintCount: allowedMints?.length ?? 0,
    amount,
    candidateCount: candidates.length,
    candidates: candidates.map((candidate) => ({
      mintUrlLength: candidate.mintUrl.length,
      balance: candidate.balance,
    })),
  });
  return candidates;
}

export function buildChooseAmountFallback(args: {
  walletCtx: WalletContext;
  ctx: FlowContext;
  destination: Destination;
  amount: number;
  preferredMintUrl?: string;
}): ChooseAmountFallback | null {
  logger.debug('amountFallback.chooseAmount.start', {
    destination: args.destination,
    amount: args.amount,
    hasPreferredMint: !!args.preferredMintUrl,
    preferredMintUrlLength: args.preferredMintUrl?.length ?? 0,
    hasCurrentMint: !!args.ctx.mintUrl,
    currentMintUrlLength: args.ctx.mintUrl?.length ?? 0,
    supportedMintCount: args.ctx.supportedMintUrls?.length ?? 0,
    offline: !!args.ctx.offline,
    hasP2pkLock: !!args.ctx.p2pkLockPubkey,
    p2pkLockPubkeyLength: args.ctx.p2pkLockPubkey?.length ?? 0,
  });

  if (
    args.destination === 'paymentRequest' ||
    args.destination === 'mintQuote'
  ) {
    logger.debug('amountFallback.chooseAmount.skip', {
      destination: args.destination,
      reason: 'unsupported_destination',
    });
    return null;
  }
  if (args.destination === 'meltQuote' && args.ctx.offline) {
    logger.debug('amountFallback.chooseAmount.skip', {
      destination: args.destination,
      reason: 'offline_melt',
    });
    return null;
  }
  // A fixed-amount Lightning target (bolt11 invoice / bolt12 offer with the
  // amount baked in) cannot be paid partially — a rounded-down melt would
  // underpay an invoice the network rejects. Insufficient balance is terminal
  // there; only user-chosen-amount targets (lightning address, LNURL,
  // amountless invoice) get the choose-amount fallback.
  if (args.destination === 'meltQuote' && hasFixedLightningAmount(args.ctx)) {
    logger.info('amountFallback.chooseAmount.skip', {
      destination: args.destination,
      amount: args.amount,
      reason: 'fixed_lightning_amount',
    });
    return null;
  }

  const fallbackMint =
    args.destination === 'meltQuote'
      ? pickHighestBalanceFallbackMint(args.walletCtx, args.ctx)
      : pickFallbackMint(args.walletCtx, args.ctx, args.preferredMintUrl);
  if (!fallbackMint) {
    logger.info('amountFallback.chooseAmount.none', {
      destination: args.destination,
      amount: args.amount,
    });
    return null;
  }

  if (args.destination === 'sendEcash' && args.ctx.offline) {
    // Offline fallbacks route to local-proof tokens, which can never carry a
    // P2PK lock — locked sends get no offline amount fallback.
    if (args.ctx.p2pkLockPubkey) {
      logger.info('amountFallback.chooseAmount.skipLockedOffline', {
        ...mintUrlSummary(fallbackMint.mintUrl),
        amount: args.amount,
        p2pkLockPubkeyLength: args.ctx.p2pkLockPubkey.length,
      });
      return null;
    }
    const built = buildProofSuggestions(fallbackMint.proofAmounts, args.amount);
    if (built.exactMatch || !built.hasSuggestion) {
      logger.debug('amountFallback.chooseAmount.offlineNoSuggestion', {
        ...mintUrlSummary(fallbackMint.mintUrl),
        amount: args.amount,
        exactMatch: built.exactMatch,
        hasSuggestion: built.hasSuggestion,
      });
      return null;
    }
    logger.info('amountFallback.chooseAmount.offlineSuggestion', {
      ...mintUrlSummary(fallbackMint.mintUrl),
      amount: args.amount,
      proofCount: fallbackMint.proofAmounts.length,
      hasRoundDown: !!built.suggestions.roundDown,
      hasRoundUp: !!built.suggestions.roundUp,
    });
    return {
      mintUrl: fallbackMint.mintUrl,
      proofAmounts: fallbackMint.proofAmounts,
      suggestions: built.suggestions,
    };
  }

  const built = buildBalanceSuggestions(fallbackMint.balance, args.amount);
  if (!built.hasSuggestion) {
    logger.debug('amountFallback.chooseAmount.noBalanceSuggestion', {
      ...mintUrlSummary(fallbackMint.mintUrl),
      balance: fallbackMint.balance,
      amount: args.amount,
    });
    return null;
  }
  logger.info('amountFallback.chooseAmount.balanceSuggestion', {
    ...mintUrlSummary(fallbackMint.mintUrl),
    balance: fallbackMint.balance,
    amount: args.amount,
    hasRoundDown: !!built.suggestions.roundDown,
  });
  return {
    mintUrl: fallbackMint.mintUrl,
    proofAmounts: fallbackMint.proofAmounts,
    suggestions: built.suggestions,
  };
}

function hasFixedLightningAmount(ctx: FlowContext): boolean {
  const intent = ctx.intent;
  if (!intent) return false;
  if (
    intent.type !== 'meltLightningInvoice' &&
    intent.type !== 'meltBolt12Offer'
  ) {
    return false;
  }
  return intent.option.amount != null && intent.option.amount > 0;
}

function pickFallbackMint(
  walletCtx: WalletContext,
  ctx: FlowContext,
  preferredMintUrl?: string,
): FallbackMint | null {
  const allowed = ctx.supportedMintUrls?.length
    ? new Set(ctx.supportedMintUrls)
    : null;
  const toFallbackMint = (mintUrl: string): FallbackMint | null => {
    if (!walletCtx.trustedMintUrls.includes(mintUrl)) return null;
    if (allowed && !allowed.has(mintUrl)) return null;
    const balance = walletCtx.mintBalances[mintUrl] ?? 0;
    if (balance <= 0) return null;
    return {
      mintUrl,
      balance,
      proofAmounts: walletCtx.proofAmounts[mintUrl] ?? [],
    };
  };

  if (ctx.mintUrl) {
    const current = toFallbackMint(ctx.mintUrl);
    if (current) {
      logger.debug('amountFallback.pickFallbackMint.selected', {
        reason: 'current',
        ...mintUrlSummary(current.mintUrl),
        balance: current.balance,
        proofCount: current.proofAmounts.length,
      });
      return current;
    }
  }

  if (preferredMintUrl) {
    const preferred = toFallbackMint(preferredMintUrl);
    if (preferred) {
      logger.debug('amountFallback.pickFallbackMint.selected', {
        reason: 'preferred',
        ...mintUrlSummary(preferred.mintUrl),
        balance: preferred.balance,
        proofCount: preferred.proofAmounts.length,
      });
      return preferred;
    }
  }

  const fallback =
    walletCtx.trustedMintUrls
      .map((mintUrl) => toFallbackMint(mintUrl))
      .filter((mint): mint is FallbackMint => mint != null)
      .sort((a, b) => b.balance - a.balance)[0] ?? null;
  logger.debug('amountFallback.pickFallbackMint.result', {
    selected: !!fallback,
    ...mintUrlSummary(fallback?.mintUrl),
    balance: fallback?.balance,
    proofCount: fallback?.proofAmounts.length,
    allowedMintCount: ctx.supportedMintUrls?.length ?? 0,
  });
  return fallback;
}

function pickHighestBalanceFallbackMint(
  walletCtx: WalletContext,
  ctx: FlowContext,
): FallbackMint | null {
  const allowed = ctx.supportedMintUrls?.length
    ? new Set(ctx.supportedMintUrls)
    : null;

  const fallback =
    walletCtx.trustedMintUrls
      .filter((mintUrl) => !allowed || allowed.has(mintUrl))
      .map((mintUrl) => ({
        mintUrl,
        balance: walletCtx.mintBalances[mintUrl] ?? 0,
        proofAmounts: walletCtx.proofAmounts[mintUrl] ?? [],
      }))
      .filter((mint) => mint.balance > 0)
      .sort((a, b) => b.balance - a.balance)[0] ?? null;
  logger.debug('amountFallback.pickHighestBalance.result', {
    selected: !!fallback,
    ...mintUrlSummary(fallback?.mintUrl),
    balance: fallback?.balance,
    proofCount: fallback?.proofAmounts.length,
    allowedMintCount: ctx.supportedMintUrls?.length ?? 0,
  });
  return fallback;
}
