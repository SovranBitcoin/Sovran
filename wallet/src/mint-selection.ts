// ---------------------------------------------------------------------------
// Mint Selection
//
// Given allowed mints, balances, and a preferred mint, determines which
// mint to use. Returns one of: a single selected mint, a list of valid
// mints requiring user choice, or a "no valid mint" signal.
// ---------------------------------------------------------------------------

import { localizeReason } from "./formatting/locales";
import { logger, mintUrlFields } from "./logger";
import type {
  WalletContext,
  MintSelectionResult,
  MintCandidate,
} from "./types";

export interface MintSelectionConfig {
  /** Mints allowed by the payment request. Empty/undefined = any trusted mint. */
  allowedMints?: string[];
  /** Minimum balance required (e.g. from payment request amount). */
  minAmount?: number;
  /** Strategy when multiple mints qualify. Defaults to 'highestBalance'. */
  strategy?: "highestBalance" | "preferredFirst";
}

export function getValidMintCandidates(
  ctx: WalletContext,
  config: MintSelectionConfig = {},
): MintCandidate[] {
  const { allowedMints, minAmount, strategy = "highestBalance" } = config;
  logger.debug("mintSelection.candidates.start", {
    trustedMintCount: ctx.trustedMintUrls.length,
    allowedMintCount: allowedMints?.length ?? 0,
    hasMinAmount: minAmount != null && minAmount > 0,
    strategy,
  });

  let candidates: MintCandidate[] = ctx.trustedMintUrls
    .map((mintUrl) => ({
      mintUrl,
      balance: ctx.mintBalances[mintUrl] ?? 0,
    }))
    .filter((candidate) => candidate.balance > 0);

  if (allowedMints && allowedMints.length > 0) {
    const allowedSet = new Set(allowedMints);
    candidates = candidates.filter((candidate) =>
      allowedSet.has(candidate.mintUrl),
    );
  }

  if (minAmount != null && minAmount > 0) {
    candidates = candidates.filter(
      (candidate) => candidate.balance >= minAmount,
    );
  }

  if (strategy === "highestBalance") {
    candidates.sort((a, b) => b.balance - a.balance);
  }

  logger.info("mintSelection.candidates.result", {
    candidateCount: candidates.length,
    strategy,
    allowedMintCount: allowedMints?.length ?? 0,
    hasMinAmount: minAmount != null && minAmount > 0,
    candidates: candidates.map((candidate) => ({
      ...mintUrlFields(candidate.mintUrl),
      balance: candidate.balance,
    })),
  });
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
  config: MintSelectionConfig = {},
  locale: string = "en",
): MintSelectionResult {
  const { allowedMints, strategy = "highestBalance" } = config;
  logger.debug("mintSelection.select.start", {
    trustedMintCount: ctx.trustedMintUrls.length,
    allowedMintCount: allowedMints?.length ?? 0,
    hasMinAmount: config.minAmount != null && config.minAmount > 0,
    hasPreferredMint: !!ctx.preferredMintUrl,
    strategy,
    locale,
  });
  const candidates = getValidMintCandidates(ctx, config);

  if (candidates.length === 0) {
    let code: string;
    if (allowedMints && allowedMints.length > 0) {
      const anyTrusted = allowedMints.some((m) =>
        ctx.trustedMintUrls.includes(m),
      );
      code = !anyTrusted
        ? "NO_ALLOWED_MINT_TRUSTED"
        : "INSUFFICIENT_BALANCE_ALLOWED";
    } else {
      code = "NO_MINT_SUFFICIENT_BALANCE";
    }
    const result = {
      type: "noValidMint" as const,
      reason: localizeReason(code, locale)!,
    };
    logger.warn("mintSelection.select.noValidMint", {
      code,
      allowedMintCount: allowedMints?.length ?? 0,
      trustedMintCount: ctx.trustedMintUrls.length,
    });
    return result;
  }

  // Sort by strategy
  if (strategy === "highestBalance") {
    candidates.sort((a, b) => b.balance - a.balance);
  }

  // Preferred mint gets priority when it's in the valid set
  if (ctx.preferredMintUrl) {
    const preferred = candidates.find(
      (c) => c.mintUrl === ctx.preferredMintUrl,
    );
    if (preferred) {
      const result = {
        type: "selected",
        mintUrl: preferred.mintUrl,
        balance: preferred.balance,
      } as const;
      logger.info("mintSelection.select.selected", {
        reason: "preferred",
        ...mintUrlFields(result.mintUrl),
        balance: result.balance,
        candidateCount: candidates.length,
      });
      return result;
    }
  }

  if (candidates.length === 1) {
    const result = {
      type: "selected",
      mintUrl: candidates[0].mintUrl,
      balance: candidates[0].balance,
    } as const;
    logger.info("mintSelection.select.selected", {
      reason: "single_candidate",
      ...mintUrlFields(result.mintUrl),
      balance: result.balance,
      candidateCount: candidates.length,
    });
    return result;
  }

  const result = { type: "selectionNeeded" as const, validMints: candidates };
  logger.info("mintSelection.select.selectionNeeded", {
    candidateCount: candidates.length,
    candidates: candidates.map((candidate) => ({
      ...mintUrlFields(candidate.mintUrl),
      balance: candidate.balance,
    })),
  });
  return result;
}

/**
 * Pick a single mint from an already-filtered candidate set, honoring the
 * user's preferred mint.
 *
 * Unlike {@link selectMint}, this operates on a caller-supplied candidate list
 * (e.g. the method-aware, full-amount melt candidates) rather than deriving one
 * from balances alone, so it stays method-aware: the caller has already
 * narrowed to mints that support the operation and can cover the amount.
 *
 * Returns the preferred mint when it is among the candidates, otherwise the
 * highest-balance candidate. Returns `undefined` for an empty list.
 */
export function pickPreferredCandidate(
  candidates: MintCandidate[],
  preferredMintUrl?: string,
): MintCandidate | undefined {
  if (candidates.length === 0) return undefined;
  if (preferredMintUrl) {
    const preferred = candidates.find((c) => c.mintUrl === preferredMintUrl);
    if (preferred) return preferred;
  }
  return candidates.reduce((best, c) => (c.balance > best.balance ? c : best));
}

/**
 * Resolve the mint to preselect when entering a send amount screen.
 *
 * The explicit mint (from context) or the user's preferred mint wins when it
 * holds a balance. When it is empty, fall back to the balance-aware pick so
 * the amount screen opens on a mint that can actually fund the send:
 * preferred-if-funded, otherwise the highest-balance funded mint. When no
 * mint holds any balance, return the original candidate unchanged so the
 * NO_VALID_MINT error at amount commit keeps its current shape.
 */
export function preselectMintForSend(
  explicitMintUrl: string | undefined,
  ctx: WalletContext,
): string | undefined {
  const candidate = explicitMintUrl ?? ctx.preferredMintUrl;
  if (candidate && (ctx.mintBalances[candidate] ?? 0) > 0) return candidate;
  const funded = pickPreferredCandidate(
    getValidMintCandidates(ctx),
    ctx.preferredMintUrl,
  );
  if (funded && funded.mintUrl !== candidate) {
    logger.info("mintSelection.preselect.fundedFallback", {
      ...mintUrlFields(funded.mintUrl),
      balance: funded.balance,
      hadCandidate: !!candidate,
    });
  }
  return funded?.mintUrl ?? candidate;
}

/**
 * Select the best mint for a Lightning melt operation.
 * Lightning melts can use any trusted mint with balance.
 * Prefers the wallet's preferred mint if it has sufficient balance.
 */
export function selectMintForMelt(
  ctx: WalletContext,
  minAmount?: number,
): MintSelectionResult {
  logger.debug("mintSelection.selectForMelt.start", {
    trustedMintCount: ctx.trustedMintUrls.length,
    hasMinAmount: minAmount != null && minAmount > 0,
  });
  return selectMint(ctx, { minAmount, strategy: "highestBalance" });
}
