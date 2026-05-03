// ---------------------------------------------------------------------------
// Quick Send Suggestions
//
// Pure function that computes offline-composable quick send suggestions from
// available proofs. Collects all achievable amounts from a large pool of fiat
// and sat targets, then picks an evenly distributed subset from each category.
// All suggestions are guaranteed offline-composable.
// ---------------------------------------------------------------------------

import { composeFiat, composeSatoshis } from '../offline';
import type { AmountInputMode } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuickSendSuggestion {
  /** Display label: "$5" or "1,000 sats" */
  label: string;
  /** Raw input value to set on tap */
  inputValue: string;
  /** Input mode to switch to on tap */
  inputMode: AmountInputMode;
  /** Exact sat amount this resolves to (offline-composable) */
  satoshis: number;
  /** When true, this suggestion represents the full wallet balance. */
  sendAll?: boolean;
}

export interface QuickSendConfig {
  /** Fiat amounts to try (default: broad range from $0.10 to $100) */
  fiatTargets?: number[];
  /** Sat amounts to try (default: broad range from 21 to 100,000) */
  satTargets?: number[];
  /** Max suggestions to pick per category (default: 3) */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const SATS_PER_BTC = 100_000_000;

const DEFAULT_FIAT_TARGETS = [0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 15, 20, 25, 50, 100];

const DEFAULT_SAT_TARGETS = [21, 50, 100, 250, 500, 1000, 2100, 5000, 10000, 21000, 50000, 100000];

const DEFAULT_LIMIT = 3;

const satFormatter = new Intl.NumberFormat('en-US', {
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
  if (fiat <= 0) return '';
  if (fiat === Math.floor(fiat)) return String(fiat);
  const str = fiat.toFixed(2);
  return str.replace(/0+$/, '').replace(/\.$/, '');
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
// Core
// ---------------------------------------------------------------------------

export function computeQuickSendSuggestions(
  proofAmounts: number[],
  btcPrice: number,
  options: {
    fiatCurrency?: string;
    fiatSymbol?: string;
    config?: QuickSendConfig;
  } = {}
): QuickSendSuggestion[] {
  const { fiatCurrency, fiatSymbol, config } = options;
  const fiatTargets = config?.fiatTargets ?? DEFAULT_FIAT_TARGETS;
  const satTargets = config?.satTargets ?? DEFAULT_SAT_TARGETS;
  const limit = config?.limit ?? DEFAULT_LIMIT;

  if (proofAmounts.length === 0) return [];

  const totalBalance = proofAmounts.reduce((a, b) => a + b, 0);
  if (totalBalance <= 0) return [];

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
        inputMode: 'fiat',
        satoshis: sats,
      });
    }
  }

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
      inputMode: 'sat',
      satoshis: satTarget,
    });
  }

  // Pick evenly distributed subset from each category, merge, sort
  const pickedFiat = pickDistributed(allFiat, limit);
  const pickedSat = pickDistributed(allSat, limit);

  const sorted = [...pickedFiat, ...pickedSat].sort((a, b) => a.satoshis - b.satoshis);

  // Append "Send all" as the last suggestion (always composable — uses all proofs)
  if (totalBalance > 0) {
    sorted.push({
      label: `Send all ${satFormatter.format(totalBalance)} sats`,
      inputValue: String(totalBalance),
      inputMode: 'sat',
      satoshis: totalBalance,
      sendAll: true,
    });
  }

  return sorted;
}
