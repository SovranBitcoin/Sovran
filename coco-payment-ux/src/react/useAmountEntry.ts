// ---------------------------------------------------------------------------
// useAmountEntry — offline send mode + proof composition suggestions
//
// Combines useOfflineSendability-style send mode detection with the
// offline send suggestions logic that the amount screen needs. Returns:
//   - sendMode: whether the current amount is sendable offline (exact)
//     or requires rounding (online/selectProofs)
//   - suggestions: round-down / round-up / auto-select amounts for both
//     sat and fiat modes
//   - needsProofSelection: boolean shorthand for "selectProofs is needed"
//
// Debounces internally (300ms) and handles stale-request cancellation.
// The wallet only needs to pass amount + mint + proof-fetcher; the hook
// does the rest using coco-payment-ux composition primitives.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';

import { composeFiat, composeSatoshis } from '../offline';
import type { WalletContext } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SendMode = 'offline' | 'online' | null;

export interface OfflineSuggestion {
  amount: number;
  /** Fiat minor-unit value for display (e.g. cents). Only present in fiat mode. */
  displayMinorUnit?: number;
}

export interface AmountEntrySuggestions {
  /** Amount the wallet should auto-send (fiat rounding matched an exact proof sum). */
  autoSelectAmount: number | null;
  roundDown: OfflineSuggestion | null;
  roundUp: OfflineSuggestion | null;
}

export interface AmountEntryResult {
  sendMode: SendMode;
  /** Non-null when the amount needs rounding (sendMode === 'online'). */
  suggestions: AmountEntrySuggestions | null;
  /** True when proof selection is needed (amount not exactly constructible). */
  needsProofSelection: boolean;
}

export interface FiatContext {
  btcPrice: number;
  /** The fiat minor-unit the user entered (e.g. 150 for $1.50). */
  displayMinorUnit: number;
  /** Defaults to 100 (cents). */
  minorUnitsPerUnit?: number;
}

export interface UseAmountEntryConfig {
  /** Amount in sats. */
  amount: number;
  mintUrl?: string;
  /** Whether the device is offline (or mock-offline). */
  offline: boolean;
  walletContext: WalletContext;
  /** Async proof-amount fetcher. The hook handles caching & staleness. */
  getProofAmounts?: (mintUrl: string) => Promise<number[]>;
  /** When set, suggestions include fiat-aware rounding. */
  fiat?: FiatContext;
  /** Set to false to disable (e.g. non-sendToken flows). Defaults to true. */
  enabled?: boolean;
}

const SATS_PER_BTC = 100_000_000;
const DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAmountEntry(config: UseAmountEntryConfig): AmountEntryResult {
  const {
    amount,
    mintUrl,
    offline,
    walletContext: _walletContext,
    getProofAmounts,
    fiat,
    enabled = true,
  } = config;

  const [sendMode, setSendMode] = useState<SendMode>(null);
  const [suggestions, setSuggestions] = useState<AmountEntrySuggestions | null>(null);
  const requestIdRef = useRef(0);

  const run = useCallback(async () => {
    if (
      !enabled ||
      !offline ||
      !mintUrl ||
      !getProofAmounts ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      setSendMode(null);
      setSuggestions(null);
      return;
    }

    const requestId = ++requestIdRef.current;

    try {
      const proofAmounts = await getProofAmounts(mintUrl);

      if (requestId !== requestIdRef.current) return;

      const totalBalance = proofAmounts.reduce((a, b) => a + b, 0);
      if (totalBalance < amount) {
        setSendMode(null);
        setSuggestions(null);
        return;
      }

      const composition = composeSatoshis(proofAmounts, amount);
      if (composition.exactMatch) {
        setSendMode('offline');
        setSuggestions(null);
        return;
      }

      setSendMode('online');

      // Fiat-aware suggestions
      if (fiat && fiat.btcPrice > 0 && fiat.displayMinorUnit != null) {
        const minorUnitsPerUnit = fiat.minorUnitsPerUnit ?? 100;
        const satsPerFiat = SATS_PER_BTC / fiat.btcPrice;

        const fc = composeFiat(
          proofAmounts,
          fiat.displayMinorUnit / minorUnitsPerUnit,
          satsPerFiat
        );

        if (requestId !== requestIdRef.current) return;

        if (fc.matchedSatoshis != null) {
          setSuggestions({ autoSelectAmount: fc.matchedSatoshis, roundDown: null, roundUp: null });
          return;
        }

        const roundDown: OfflineSuggestion | null = fc.nearestLowerFiat
          ? {
              amount: fc.nearestLowerFiat.satoshis,
              displayMinorUnit: Math.round(fc.nearestLowerFiat.fiat * minorUnitsPerUnit),
            }
          : null;

        const roundUp: OfflineSuggestion | null = fc.nearestUpperFiat
          ? {
              amount: fc.nearestUpperFiat.satoshis,
              displayMinorUnit: Math.round(fc.nearestUpperFiat.fiat * minorUnitsPerUnit),
            }
          : null;

        if (roundDown || roundUp) {
          setSuggestions({ autoSelectAmount: null, roundDown, roundUp });
          return;
        }

        setSuggestions(null);
        return;
      }

      // Sat-mode suggestions
      const roundDown =
        composition.nearestLower != null ? { amount: composition.nearestLower } : null;
      const roundUp =
        composition.nearestUpper != null ? { amount: composition.nearestUpper } : null;
      const suggestions = { autoSelectAmount: null, roundDown, roundUp };
      setSuggestions(suggestions);
    } catch {
      if (requestId === requestIdRef.current) {
        setSendMode(null);
        setSuggestions(null);
      }
    }
  }, [amount, enabled, fiat, getProofAmounts, mintUrl, offline]);

  useEffect(() => {
    const t = setTimeout(run, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [run]);

  const needsProofSelection = sendMode === 'online' && suggestions !== null;

  return {
    sendMode,
    suggestions,
    needsProofSelection,
  };
}
