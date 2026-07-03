// ---------------------------------------------------------------------------
// Quick Send Suggestions
//
// Pure function that computes offline-composable quick send suggestions from
// available proofs. On the sat account it collects achievable amounts from a
// pool of display-currency and sat targets; on fiat accounts targets are
// cent-exact in the account's own unit (no price dependency). All suggestions
// are guaranteed offline-composable.
// ---------------------------------------------------------------------------

import { composeFiat, composeSatoshis } from "../offline";
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
  0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 15, 20, 25, 50, 100,
];

const DEFAULT_SAT_TARGETS = [
  21, 50, 100, 250, 500, 1000, 2100, 5000, 10000, 21000, 50000, 100000,
];

/** Fiat-account targets, in minor units (cents): $0.10 … $100. */
const DEFAULT_FIAT_UNIT_TARGETS = [
  10, 25, 50, 100, 200, 300, 500, 1000, 1500, 2000, 2500, 5000, 10000,
];

const DEFAULT_LIMIT = 3;

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
  const all: QuickSendSuggestion[] = [];
  for (const minor of DEFAULT_FIAT_UNIT_TARGETS) {
    if (minor > totalBalance || minor <= 0) continue;
    if (!composeSatoshis(proofAmounts, minor).exactMatch) continue;
    all.push({
      label: formatFiatLabel(minor / 100, symbol),
      inputValue: minorToRawInput(minor, unit),
      inputMode: "unit",
      amount: { value: minor, unit },
    });
  }

  const picked = pickDistributed(all, limit * 2).sort(
    (a, b) => a.amount.value - b.amount.value,
  );
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

    const result = composeSatoshis(proofAmounts, satTarget);
    if (!result.exactMatch) continue;

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
