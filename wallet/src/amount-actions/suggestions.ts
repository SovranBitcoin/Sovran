// ---------------------------------------------------------------------------
// Quick Send Suggestions
//
// Pure function that computes offline-composable quick send suggestions from
// available proofs. On the sat account it collects achievable amounts from a
// pool of display-currency and sat targets; on fiat accounts targets are
// cent-exact in the account's own unit (no price dependency). All suggestions
// are guaranteed offline-composable.
// ---------------------------------------------------------------------------

import {
  buildExactOfflineAmountIndex,
  composeFiat,
  composeSatoshis,
} from "../offline";
import {
  isFiatUnit,
  minorToRawInput,
  unitSymbol as symbolForUnit,
} from "../formatting/units";
import { logger } from "../logger";
import type { QuickSendConfig, QuickSendSuggestion } from "./types";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const SATS_PER_BTC = 100_000_000;

const DEFAULT_FIAT_TARGETS = [
  0.1, 0.25, 0.5, 1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200,
];

const DEFAULT_SAT_TARGETS = [
  21, 50, 100, 210, 250, 500, 750, 1000, 2100, 2500, 5000, 7500, 10000, 15000,
  21000, 25000, 50000, 75000, 100000, 210000, 500000, 1000000,
];

/** Fiat-account targets, in minor units (cents): $0.10 … $200. */
const DEFAULT_FIAT_UNIT_TARGETS = [
  10, 25, 50, 100, 200, 300, 400, 500, 1000, 1500, 2000, 2500, 3000, 4000,
  5000, 7500, 10000, 15000, 20000,
];

const DEFAULT_LIMIT = 5;

/**
 * The exact-amount index enumerates EVERY composable subset sum, so it is
 * only built when the proof count keeps it provably small (≤2^14 sums).
 * These are precisely the wallets where the nice-target sweep goes hungry —
 * a handful of odd denominations composes almost none of the round numbers,
 * and the index supplies the amounts that ARE actually sendable offline.
 * Bigger wallets compose most round targets anyway and skip the index.
 */
const INDEX_MAX_PROOFS = 14;

function maybeBuildReachableIndex(proofAmounts: number[]): number[] | null {
  if (proofAmounts.length === 0 || proofAmounts.length > INDEX_MAX_PROOFS)
    return null;
  return buildExactOfflineAmountIndex(proofAmounts).reachableSums;
}

const satFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFiatLabel(amount: number, symbol: string): string {
  if (amount >= 1 && amount === Math.floor(amount)) return `${symbol}${amount}`;
  return `${symbol}${amount.toFixed(2)}`;
}

function fiatToRawInput(fiat: number): string {
  if (fiat <= 0) return "";
  if (fiat === Math.floor(fiat)) return String(fiat);
  const str = fiat.toFixed(2);
  return str.replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Pick `limit` items evenly distributed across a sorted array.
 * Always includes first and last when limit >= 2.
 */
function pickDistributed<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  if (limit <= 0) return [];
  if (limit === 1) return [items[0]!];
  const result: T[] = [];
  for (let i = 0; i < limit; i++) {
    const idx = Math.round((i * (items.length - 1)) / (limit - 1));
    result.push(items[idx]!);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Fiat account — cent-exact targets in the account's own unit
// ---------------------------------------------------------------------------

function computeFiatUnitSuggestions(
  proofAmounts: number[],
  unit: string,
  totalBalance: number,
  config: QuickSendConfig | undefined,
): QuickSendSuggestion[] {
  const limit = config?.limit ?? DEFAULT_LIMIT;
  const symbol = symbolForUnit(unit);
  const reachable = maybeBuildReachableIndex(proofAmounts);
  const reachableSet = reachable ? new Set(reachable) : null;
  const all: QuickSendSuggestion[] = [];
  for (const minor of DEFAULT_FIAT_UNIT_TARGETS) {
    if (minor > totalBalance || minor <= 0) continue;
    // Index membership is O(1); without an index fall back to a compose call.
    const composable = reachableSet
      ? reachableSet.has(minor)
      : composeSatoshis(proofAmounts, minor).exactMatch;
    if (!composable) continue;
    all.push({
      label: formatFiatLabel(minor / 100, symbol),
      inputValue: minorToRawInput(minor, unit),
      inputMode: "unit",
      amount: { value: minor, unit },
    });
  }

  // Small wallets with odd denominations compose almost no round targets —
  // fill with the amounts that ARE composable so quick-send is never just
  // "Send all".
  if (reachable && all.length < limit) {
    const used = new Set(all.map((s) => s.amount.value));
    const fillers = pickDistributed(
      reachable.filter((minor) => minor < totalBalance && !used.has(minor)),
      limit - all.length,
    );
    for (const minor of fillers) {
      all.push({
        label: formatFiatLabel(minor / 100, symbol),
        inputValue: minorToRawInput(minor, unit),
        inputMode: "unit",
        amount: { value: minor, unit },
      });
    }
  }

  const picked = pickDistributed(
    all.sort((a, b) => a.amount.value - b.amount.value),
    limit * 2,
  ).sort((a, b) => a.amount.value - b.amount.value);
  picked.push({
    label: `Send all ${formatFiatLabel(totalBalance / 100, symbol)}`,
    inputValue: minorToRawInput(totalBalance, unit),
    inputMode: "unit",
    amount: { value: totalBalance, unit },
    sendAll: true,
  });

  logger.info("amount.suggestions.result", {
    unit,
    totalBalance,
    collected: all.length,
    totalSuggestions: picked.length,
    includesSendAll: true,
  });
  return picked;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export function computeQuickSendSuggestions(
  proofAmounts: number[],
  btcPrice: number,
  options: {
    unit?: string;
    fiatCurrency?: string;
    fiatSymbol?: string;
    config?: QuickSendConfig;
  } = {},
): QuickSendSuggestion[] {
  const { fiatCurrency, fiatSymbol, config } = options;
  const unit = options.unit ?? "sat";
  const fiatTargets = config?.fiatTargets ?? DEFAULT_FIAT_TARGETS;
  const satTargets = config?.satTargets ?? DEFAULT_SAT_TARGETS;
  const limit = config?.limit ?? DEFAULT_LIMIT;

  logger.debug("amount.suggestions.start", {
    proofCount: proofAmounts.length,
    unit,
    hasBtcPrice: btcPrice > 0,
    hasFiatCurrency: !!fiatCurrency,
    hasFiatSymbol: !!fiatSymbol,
    fiatTargetCount: fiatTargets.length,
    satTargetCount: satTargets.length,
    limit,
  });

  if (proofAmounts.length === 0) {
    logger.debug("amount.suggestions.empty", { reason: "no_proofs" });
    return [];
  }

  const totalBalance = proofAmounts.reduce((a, b) => a + b, 0);
  if (totalBalance <= 0) {
    logger.debug("amount.suggestions.empty", {
      reason: "non_positive_balance",
      proofCount: proofAmounts.length,
    });
    return [];
  }

  if (isFiatUnit(unit)) {
    return computeFiatUnitSuggestions(proofAmounts, unit, totalBalance, config);
  }

  const hasFiat = !!fiatCurrency && !!fiatSymbol && btcPrice > 0;
  const satsPerFiat = btcPrice > 0 ? SATS_PER_BTC / btcPrice : 0;
  const usedSats = new Set<number>();
  const reachable = maybeBuildReachableIndex(proofAmounts);
  const reachableSet = reachable ? new Set(reachable) : null;

  // Collect ALL achievable fiat suggestions
  const allFiat: QuickSendSuggestion[] = [];
  if (hasFiat) {
    for (const fiatAmount of fiatTargets) {
      const centerSats = Math.round(fiatAmount * satsPerFiat);
      if (centerSats > totalBalance || centerSats <= 0) continue;

      const result = composeFiat(proofAmounts, fiatAmount, satsPerFiat);
      if (!result.exactFiatMatch || result.matchedSatoshis === null) continue;

      const sats = result.matchedSatoshis;
      if (usedSats.has(sats)) continue;
      usedSats.add(sats);

      allFiat.push({
        label: formatFiatLabel(fiatAmount, fiatSymbol!),
        inputValue: fiatToRawInput(fiatAmount),
        inputMode: "fiat",
        amount: { value: sats, unit: "sat" },
      });
    }
  }
  logger.debug("amount.suggestions.fiat.collected", {
    enabled: hasFiat,
    totalBalance,
    collected: allFiat.length,
  });

  // Collect ALL achievable sat suggestions
  const allSat: QuickSendSuggestion[] = [];
  for (const satTarget of satTargets) {
    if (satTarget > totalBalance || satTarget <= 0) continue;
    if (usedSats.has(satTarget)) continue;

    // Index membership is O(1); without an index fall back to a compose call.
    const composable = reachableSet
      ? reachableSet.has(satTarget)
      : composeSatoshis(proofAmounts, satTarget).exactMatch;
    if (!composable) continue;

    usedSats.add(satTarget);

    allSat.push({
      label: `${satFormatter.format(satTarget)} sats`,
      inputValue: String(satTarget),
      inputMode: "unit",
      amount: { value: satTarget, unit: "sat" },
    });
  }
  logger.debug("amount.suggestions.sat.collected", {
    totalBalance,
    collected: allSat.length,
  });

  // Small wallets with odd denominations compose almost no round targets —
  // fill the sat category with amounts that ARE composable so quick-send is
  // never just "Send all". Only rescues the DEFAULT sweep: a caller that
  // passed explicit targets asked for exactly those.
  const customTargets = !!config?.fiatTargets || !!config?.satTargets;
  if (reachable && !customTargets && allFiat.length + allSat.length < limit) {
    const fillers = pickDistributed(
      reachable.filter((sats) => sats < totalBalance && !usedSats.has(sats)),
      limit - allFiat.length - allSat.length,
    );
    for (const sats of fillers) {
      usedSats.add(sats);
      allSat.push({
        label: `${satFormatter.format(sats)} sats`,
        inputValue: String(sats),
        inputMode: "unit",
        amount: { value: sats, unit: "sat" },
      });
    }
    allSat.sort((a, b) => a.amount.value - b.amount.value);
  }

  // Pick evenly distributed subset from each category, merge, sort
  const pickedFiat = pickDistributed(allFiat, limit);
  const pickedSat = pickDistributed(allSat, limit);

  const sorted = [...pickedFiat, ...pickedSat].sort(
    (a, b) => a.amount.value - b.amount.value,
  );

  // Append "Send all" as the last suggestion (always composable — uses all proofs)
  if (totalBalance > 0) {
    sorted.push({
      label: `Send all ${satFormatter.format(totalBalance)} sats`,
      inputValue: String(totalBalance),
      inputMode: "unit",
      amount: { value: totalBalance, unit: "sat" },
      sendAll: true,
    });
  }

  logger.info("amount.suggestions.result", {
    unit,
    totalBalance,
    fiatCollected: allFiat.length,
    satCollected: allSat.length,
    pickedFiat: pickedFiat.length,
    pickedSat: pickedSat.length,
    totalSuggestions: sorted.length,
    includesSendAll: totalBalance > 0,
  });
  return sorted;
}
