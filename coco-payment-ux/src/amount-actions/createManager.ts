// ---------------------------------------------------------------------------
// Amount Actions — stateful runtime
//
// Owns the raw keyboard string and input mode. On every inspect(), resolves
// the effective sat amount via the pure resolveAmount() function, then adds
// display fields (keyboardUnit, secondaryDisplay, fiatSymbol). Returns
// stable references via structural comparison for useSyncExternalStore.
//
// The manager computes EVERYTHING the UI needs — the component is stateless.
// ---------------------------------------------------------------------------

import { resolveAmount, resolutionEqual } from './resolve';
import type {
  AmountActionManager,
  AmountInputMode,
  AmountResolution,
  CreateAmountActionManagerConfig,
} from './types';

const SATS_PER_BTC = 100_000_000;

/**
 * Convert a fiat number to the most natural raw input string.
 *
 * - 2.00 → "2"   (FiatAmountDisplay shows "$2" with dim ".00")
 * - 0.02 → "0.02"
 * - 2.10 → "2.1" (FiatAmountDisplay shows "$2.1" with dim "0")
 * - 0    → ""
 */
function fiatToRawInput(fiat: number): string {
  if (fiat <= 0) return '';
  const str = fiat.toFixed(2);
  return str.replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Format the secondary display text shown beneath the amount.
 * In fiat mode shows sat equivalent; in sat mode shows fiat equivalent.
 */
function formatSecondaryDisplay(
  inputMode: AmountInputMode,
  displaySats: number,
  displayFiat: number | null,
  fiatSymbol: string
): string {
  if (inputMode === 'fiat') {
    if (displaySats > 0) {
      return `≈ ${displaySats.toLocaleString('en-US')} sats`;
    }
    return '≈ 0 sats';
  }
  if (displayFiat != null && displayFiat > 0) {
    return `≈ ${fiatSymbol}${displayFiat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `≈ ${fiatSymbol}0.00`;
}

export function createAmountActionManager(
  config: CreateAmountActionManagerConfig
): AmountActionManager {
  const {
    getMintUrl,
    getProofAmounts,
    getBtcPrice,
    offlineOptimization,
    unit,
    fiatCurrency,
    fiatSymbol,
  } = config;

  const hasFiatToggle = !!fiatCurrency && !!fiatSymbol;

  let inputMode: AmountInputMode = 'sat';
  let rawInput = '';
  let prevResolution: AmountResolution | null = null;
  const listeners = new Set<() => void>();

  function notify(): void {
    prevResolution = null;
    for (const fn of listeners) fn();
  }

  function parseNumericValue(input: string): number {
    if (!input) return 0;
    const parsed = parseFloat(input);
    return isNaN(parsed) ? 0 : parsed;
  }

  function compute(): AmountResolution {
    const numericValue = parseNumericValue(rawInput);
    const mintUrl = getMintUrl();
    const proofAmounts = mintUrl ? getProofAmounts() : [];
    const btcPrice = getBtcPrice();
    const core = resolveAmount(
      inputMode,
      rawInput,
      numericValue,
      proofAmounts,
      btcPrice,
      offlineOptimization
    );

    // Keyboard unit: fiat currency code in fiat mode, base unit otherwise
    const keyboardUnit = inputMode === 'fiat' && fiatCurrency ? fiatCurrency : unit;

    // Secondary display: only when fiat toggle is available and btcPrice is valid
    let secondaryDisplay: string | null = null;
    if (hasFiatToggle && btcPrice > 0) {
      secondaryDisplay = formatSecondaryDisplay(
        inputMode,
        core.displaySats,
        core.displayFiat,
        fiatSymbol!
      );
    }

    return {
      ...core,
      unit,
      keyboardUnit,
      secondaryDisplay,
      fiatSymbol: hasFiatToggle && btcPrice > 0 ? fiatSymbol! : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  const inspect = (): AmountResolution => {
    const next = compute();
    if (prevResolution && resolutionEqual(prevResolution, next)) {
      return prevResolution;
    }
    prevResolution = next;
    return next;
  };

  const setInput = (input: string): void => {
    rawInput = input;
    notify();
  };

  const toggle = (): void => {
    if (!hasFiatToggle) return;

    const btcPrice = getBtcPrice();
    if (btcPrice <= 0) return;

    const current = inspect();

    if (inputMode === 'sat') {
      // sat → fiat: convert current sats to fiat display value
      inputMode = 'fiat';
      if (current.numericValue > 0 && current.displayFiat != null && current.displayFiat > 0) {
        rawInput = fiatToRawInput(current.displayFiat);
      } else {
        rawInput = '';
      }
    } else {
      // fiat → sat: use the effective (possibly auto-optimized) sat amount
      inputMode = 'sat';
      if (current.effectiveSatAmount > 0) {
        rawInput = String(current.effectiveSatAmount);
      } else {
        rawInput = '';
      }
    }
    notify();
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { setInput, toggle, inspect, subscribe };
}
