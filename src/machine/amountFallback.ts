import { composeSatoshis } from '../offline';
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

export function buildProofSuggestions(
  proofAmounts: number[],
  amount: number
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

  return {
    exactMatch: composition.exactMatch,
    suggestions: { roundDown, roundUp },
    hasSuggestion: roundDown != null || roundUp != null,
  };
}

export function buildBalanceSuggestions(
  balance: number,
  amount: number
): {
  suggestions: Suggestions;
  hasSuggestion: boolean;
} {
  const roundDown = balance > 0 && balance < amount ? { amount: balance } : null;
  return {
    suggestions: { roundDown, roundUp: null },
    hasSuggestion: roundDown != null,
  };
}

export function buildChooseProofsData(args: {
  mintUrl: string;
  amount: number;
  unit: string;
  proofAmounts: number[];
  suggestions: Suggestions;
  ctx: FlowContext;
}): StepDataMap['chooseProofs'] {
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
  allowedMints?: string[]
): MintCandidate[] {
  const allowed = allowedMints?.length ? new Set(allowedMints) : null;
  return walletCtx.trustedMintUrls
    .map((mintUrl) => ({
      mintUrl,
      balance: walletCtx.mintBalances[mintUrl] ?? 0,
    }))
    .filter((candidate) => {
      if (allowed && !allowed.has(candidate.mintUrl)) return false;
      return candidate.balance >= amount;
    })
    .sort((a, b) => b.balance - a.balance);
}

export function buildChooseAmountFallback(args: {
  walletCtx: WalletContext;
  ctx: FlowContext;
  destination: Destination;
  amount: number;
  preferredMintUrl?: string;
}): ChooseAmountFallback | null {
  if (args.destination === 'paymentRequest' || args.destination === 'mintQuote') return null;
  if (args.destination === 'meltQuote' && args.ctx.offline) return null;

  const fallbackMint =
    args.destination === 'meltQuote'
      ? pickHighestBalanceFallbackMint(args.walletCtx, args.ctx)
      : pickFallbackMint(args.walletCtx, args.ctx, args.preferredMintUrl);
  if (!fallbackMint) return null;

  if (args.destination === 'sendEcash' && args.ctx.offline) {
    // Offline fallbacks route to local-proof tokens, which can never carry a
    // P2PK lock — locked sends get no offline amount fallback.
    if (args.ctx.p2pkLockPubkey) return null;
    const built = buildProofSuggestions(fallbackMint.proofAmounts, args.amount);
    if (built.exactMatch || !built.hasSuggestion) return null;
    return {
      mintUrl: fallbackMint.mintUrl,
      proofAmounts: fallbackMint.proofAmounts,
      suggestions: built.suggestions,
    };
  }

  const built = buildBalanceSuggestions(fallbackMint.balance, args.amount);
  if (!built.hasSuggestion) return null;
  return {
    mintUrl: fallbackMint.mintUrl,
    proofAmounts: fallbackMint.proofAmounts,
    suggestions: built.suggestions,
  };
}

function pickFallbackMint(
  walletCtx: WalletContext,
  ctx: FlowContext,
  preferredMintUrl?: string
): FallbackMint | null {
  const allowed = ctx.supportedMintUrls?.length ? new Set(ctx.supportedMintUrls) : null;
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
    if (current) return current;
  }

  if (preferredMintUrl) {
    const preferred = toFallbackMint(preferredMintUrl);
    if (preferred) return preferred;
  }

  return (
    walletCtx.trustedMintUrls
      .map((mintUrl) => toFallbackMint(mintUrl))
      .filter((mint): mint is FallbackMint => mint != null)
      .sort((a, b) => b.balance - a.balance)[0] ?? null
  );
}

function pickHighestBalanceFallbackMint(
  walletCtx: WalletContext,
  ctx: FlowContext
): FallbackMint | null {
  const allowed = ctx.supportedMintUrls?.length ? new Set(ctx.supportedMintUrls) : null;

  return (
    walletCtx.trustedMintUrls
      .filter((mintUrl) => !allowed || allowed.has(mintUrl))
      .map((mintUrl) => ({
        mintUrl,
        balance: walletCtx.mintBalances[mintUrl] ?? 0,
        proofAmounts: walletCtx.proofAmounts[mintUrl] ?? [],
      }))
      .filter((mint) => mint.balance > 0)
      .sort((a, b) => b.balance - a.balance)[0] ?? null
  );
}
