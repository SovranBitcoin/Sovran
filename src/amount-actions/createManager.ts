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

import { logger } from '../logger';
import { resolveAmount, resolutionEqual } from './resolve';
import { computeQuickSendSuggestions } from './suggestions';
import type { QuickSendSuggestion ,
  AmountActionManager,
  AmountInputMode,
  AmountResolution,
  CreateAmountActionManagerConfig,
} from './types';

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

/**
 * Resolve a value-or-getter config field to a getter. A constant becomes a
 * getter that returns it; an existing getter passes through. Lets the manager
 * read a single canonical shape regardless of which form the caller used.
 */
function asGetter<T>(value: T | (() => T)): () => T {
  return typeof value === 'function' ? (value as () => T) : () => value;
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
    quickSendConfig,
  } = config;

  const getOfflineOptimization = asGetter(offlineOptimization);
  const getUnit = asGetter(unit);
  const getFiatCurrency = asGetter<string | undefined>(fiatCurrency);
  const getFiatSymbol = asGetter<string | undefined>(fiatSymbol);
  const hasFiatToggleNow = (): boolean => !!getFiatCurrency() && !!getFiatSymbol();
  const suggestionsDisabled = quickSendConfig === null;

  let inputMode: AmountInputMode = 'sat';
  let rawInput = '';
  let prevResolution: AmountResolution | null = null;
  const listeners = new Set<() => void>();

  // Suggestion cache — invalidated when proofs or price change
  const EMPTY_SUGGESTIONS: QuickSendSuggestion[] = [];
  let sugCache: { len: number; sum: number; price: number; result: QuickSendSuggestion[] } | null =
    null;

  function getSuggestions(): QuickSendSuggestion[] {
    if (!getOfflineOptimization() || suggestionsDisabled) return EMPTY_SUGGESTIONS;
    const proofs = getProofAmounts();
    const price = getBtcPrice();
    if (proofs.length === 0 || price <= 0) return EMPTY_SUGGESTIONS;

    const len = proofs.length;
    const sum = proofs.reduce((a, b) => a + b, 0);
    if (sugCache && sugCache.len === len && sugCache.sum === sum && sugCache.price === price) {
      return sugCache.result;
    }

    const result = computeQuickSendSuggestions(proofs, price, {
      fiatCurrency: getFiatCurrency(),
      fiatSymbol: getFiatSymbol(),
      config: quickSendConfig ?? undefined,
    });
    // Logged so we can verify the "Send all" suggestion's satoshis matches the
    // actual sum of available proofs. Mismatches indicate the wallet's
    // proofAmounts cache is stale relative to coco's proof state.
    const sendAll = result.find((s) => s.sendAll);
    logger.info('amountActions.suggestion.derive', {
      proofCount: len,
      spendableTotal: sum,
      displayedSendAll: sendAll?.satoshis ?? null,
    });
    sugCache = { len, sum, price, result };
    return result;
  }

  function notify(): void {
    // Don't invalidate `prevResolution` — `inspect()`'s structural-equal check
    // already promotes a new ref only when the resolution actually changed,
    // so notifying here without clearing the cache lets useSyncExternalStore
    // skip re-renders for setInput calls that produce structurally equal output.
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
    const offlineOpt = getOfflineOptimization();
    const unitNow = getUnit();
    const fiatCurrencyNow = getFiatCurrency();
    const fiatSymbolNow = getFiatSymbol();
    const fiatToggleAvailable = !!fiatCurrencyNow && !!fiatSymbolNow;
    const fiatToggleActive = fiatToggleAvailable && btcPrice > 0;

    const core = resolveAmount(
      inputMode,
      rawInput,
      numericValue,
      proofAmounts,
      btcPrice,
      offlineOpt
    );

    // Keyboard unit: fiat currency code in fiat mode, base unit otherwise
    const keyboardUnit = inputMode === 'fiat' && fiatCurrencyNow ? fiatCurrencyNow : unitNow;

    // Secondary display: only when fiat toggle is available and btcPrice is valid
    const secondaryDisplay = fiatToggleActive
      ? formatSecondaryDisplay(inputMode, core.displaySats, core.displayFiat, fiatSymbolNow!)
      : null;

    return {
      ...core,
      unit: unitNow,
      keyboardUnit,
      secondaryDisplay,
      fiatCurrency: fiatToggleActive ? fiatCurrencyNow! : null,
      fiatSymbol: fiatToggleActive ? fiatSymbolNow! : null,
      btcPrice,
      suggestions: getSuggestions(),
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

  const setMode = (mode: AmountInputMode): void => {
    if (!hasFiatToggleNow() || mode === inputMode) return;
    inputMode = mode;
    // Don't notify — caller will follow with setInput.
  };

  const toggle = (): void => {
    if (!hasFiatToggleNow()) return;

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

  return { setInput, setMode, toggle, inspect, subscribe };
}
