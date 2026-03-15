// ---------------------------------------------------------------------------
// Mint Selection
//
// Given allowed mints, balances, and a preferred mint, determines which
// mint to use. Returns one of: a single selected mint, a list of valid
// mints requiring user choice, or a "no valid mint" signal.
// ---------------------------------------------------------------------------

import type { WalletContext, MintSelectionResult, MintCandidate } from './types';

export interface MintSelectionConfig {
  /** Mints allowed by the payment request. Empty/undefined = any trusted mint. */
  allowedMints?: string[];
  /** Minimum balance required (e.g. from payment request amount). */
  minAmount?: number;
  /** Strategy when multiple mints qualify. Defaults to 'highestBalance'. */
  strategy?: 'highestBalance' | 'preferredFirst';
}

export function getValidMintCandidates(
  ctx: WalletContext,
  config: MintSelectionConfig = {}
): MintCandidate[] {
  const { allowedMints, minAmount, strategy = 'highestBalance' } = config;

  let candidates: MintCandidate[] = ctx.trustedMintUrls
    .map((mintUrl) => ({
      mintUrl,
      balance: ctx.mintBalances[mintUrl] ?? 0,
    }))
    .filter((candidate) => candidate.balance > 0);

  if (allowedMints && allowedMints.length > 0) {
    const allowedSet = new Set(allowedMints);
    candidates = candidates.filter((candidate) => allowedSet.has(candidate.mintUrl));
  }

  if (minAmount != null && minAmount > 0) {
    candidates = candidates.filter((candidate) => candidate.balance >= minAmount);
  }

  if (strategy === 'highestBalance') {
    candidates.sort((a, b) => b.balance - a.balance);
  }

  return candidates;
}

/**
 * Select a mint based on wallet context and constraints.
 *
 * Logic:
 * 1. Filter trusted mints to those with balance > 0
 * 2. If allowedMints is set, further filter to intersection
 * 3. If minAmount is set, further filter to mints with sufficient balance
 * 4. Sort by strategy
 * 5. If preferred mint is in the valid set, select it
 * 6. If exactly one valid mint, auto-select
 * 7. If multiple, return selectionNeeded
 * 8. If none, return noValidMint
 */
export function selectMint(
  ctx: WalletContext,
  config: MintSelectionConfig = {}
): MintSelectionResult {
  const { allowedMints, strategy = 'highestBalance' } = config;
  const candidates = getValidMintCandidates(ctx, config);

  if (candidates.length === 0) {
    let reason: string;
    if (allowedMints && allowedMints.length > 0) {
      const anyTrusted = allowedMints.some((m) => ctx.trustedMintUrls.includes(m));
      reason = !anyTrusted ? 'No allowed mint is trusted' : 'Insufficient balance on allowed mints';
    } else {
      reason = 'No mint with sufficient balance';
    }
    return { type: 'noValidMint', reason };
  }

  // Sort by strategy
  if (strategy === 'highestBalance') {
    candidates.sort((a, b) => b.balance - a.balance);
  }

  // Preferred mint gets priority when it's in the valid set
  if (ctx.preferredMintUrl) {
    const preferred = candidates.find((c) => c.mintUrl === ctx.preferredMintUrl);
    if (preferred) {
      return {
        type: 'selected',
        mintUrl: preferred.mintUrl,
        balance: preferred.balance,
      };
    }
  }

  if (candidates.length === 1) {
    return {
      type: 'selected',
      mintUrl: candidates[0].mintUrl,
      balance: candidates[0].balance,
    };
  }

  return { type: 'selectionNeeded', validMints: candidates };
}

/**
 * Select the best mint for a Lightning melt operation.
 * Lightning melts can use any trusted mint with balance.
 * Prefers the wallet's preferred mint if it has sufficient balance.
 */
export function selectMintForMelt(ctx: WalletContext, minAmount?: number): MintSelectionResult {
  return selectMint(ctx, { minAmount, strategy: 'highestBalance' });
}
