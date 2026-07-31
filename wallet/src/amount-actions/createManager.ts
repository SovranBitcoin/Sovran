// ---------------------------------------------------------------------------
// Amount Actions — stateful runtime
//
// Owns the raw keyboard string and input mode. On every inspect(), resolves
// the effective minor-unit amount via the pure resolveAmount() function, then
// adds display fields (keyboardUnit, secondaryDisplay, unitSymbol). Returns
// stable references via structural comparison for useSyncExternalStore.
//
// The manager computes EVERYTHING the UI needs — the component is stateless.
// ---------------------------------------------------------------------------

import { logger } from '../logger';
import {
  isFiatUnit,
  majorToMinor,
  minorToRawInput,
  unitSymbol as symbolForUnit,
} from '../formatting/units';
import { resolveAmount, resolutionEqual } from './resolve';
import { computeQuickSendSuggestions } from './suggestions';
import type {
  QuickSendSuggestion,
  AmountActionManager,
  AmountInputMode,
  AmountResolution,
  CreateAmountActionManagerConfig,
  UnitAmount,
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
 * Format the secondary display text shown beneath the amount on the sat
 * account. In fiat mode shows sat equivalent; in unit mode shows the
 * display-currency equivalent. Fiat accounts render no secondary text.
 */
function formatSecondaryDisplay(
  inputMode: AmountInputMode,
  displayAmount: number,
  displayFiat: number | null,
  fiatSymbol: string,
): string {
  if (inputMode === 'fiat') {
    if (displayAmount > 0) {
      return `≈ ${displayAmount.toLocaleString('en-US')} sats`;
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

function sumAmounts(amounts: number[]): number {
  return amounts.reduce((total, amount) => total + amount, 0);
}

export function createAmountActionManager(
  config: CreateAmountActionManagerConfig,
): AmountActionManager {
  const {
    getMintUrl,
    getProofAmounts,
    getBtcPrice,
    offlineOptimization,
    suggestionsEnabled,
    unit,
    fiatCurrency,
    fiatSymbol,
    quickSendConfig,
    getAmountEnvelope,
  } = config;

  const getOfflineOptimization = asGetter(offlineOptimization);
  // Suggestions historically rode the offline-optimization gate; an explicit
  // `suggestionsEnabled` decouples them (ecash paths can want suggestions
  // without the offline icon / fiat-window optimization semantics).
  const getSuggestionsEnabled =
    suggestionsEnabled === undefined
      ? getOfflineOptimization
      : asGetter(suggestionsEnabled);
  const getUnit = asGetter(unit);
  const getFiatCurrency = asGetter<string | undefined>(fiatCurrency);
  const getFiatSymbol = asGetter<string | undefined>(fiatSymbol);
  // The display-currency swapper only exists on the sat account. Fiat
  // accounts input in their own unit — converting "usd worth of usd" is
  // meaningless, and "sats worth of usd" is deliberately not offered.
  const hasFiatToggleNow = (): boolean =>
    getUnit() === 'sat' && !!getFiatCurrency() && !!getFiatSymbol();
  const suggestionsDisabled = quickSendConfig === null;

  let inputMode: AmountInputMode = 'unit';
  let rawInput = '';
  let lastUnit = getUnit();
  let clampedToCap = false;
  let prevResolution: AmountResolution | null = null;
  let prevComputeLogKey: string | null = null;
  const listeners = new Set<() => void>();

  logger.info('amountActions.manager.create', {
    hasInitialMintUrl: !!getMintUrl(),
    initialMintUrlLength: getMintUrl()?.length ?? 0,
    offlineOptimizationIsGetter: typeof offlineOptimization === 'function',
    unitIsGetter: typeof unit === 'function',
    unit: lastUnit,
    fiatCurrencyIsGetter: typeof fiatCurrency === 'function',
    fiatSymbolIsGetter: typeof fiatSymbol === 'function',
    hasFiatCurrency: !!getFiatCurrency(),
    hasFiatSymbol: !!getFiatSymbol(),
    hasAmountEnvelope: !!getAmountEnvelope,
    suggestionsDisabled,
  });

  /**
   * A unit switch mid-entry (account switcher, or the mint change following
   * pickHighestBalanceUnit) resets the draft: "1.5" must never be
   * reinterpreted as dollars-that-were-sats or vice versa. Called from every
   * state read/write; no notify — the unit change itself re-renders readers.
   */
  function ensureUnitCurrent(): void {
    const unitNow = getUnit();
    if (unitNow === lastUnit) return;
    logger.info('amount.unit.reset', {
      from: lastUnit,
      to: unitNow,
      hadInput: rawInput.length > 0,
      previousMode: inputMode,
    });
    lastUnit = unitNow;
    rawInput = '';
    inputMode = 'unit';
    clampedToCap = false;
  }

  // Proof-set signature: sorted amounts joined. (length, sum) was the old
  // cache key and it collides — [4,4] and [1,7] share both but compose
  // different amounts. Memoized by array identity since getProofAmounts()
  // usually returns a stable reference between proof changes.
  let lastProofsForSig: number[] | null = null;
  let lastProofsSig = '';
  function proofSignature(proofs: number[]): string {
    if (proofs === lastProofsForSig) return lastProofsSig;
    lastProofsForSig = proofs;
    lastProofsSig = [...proofs].sort((a, b) => a - b).join(',');
    return lastProofsSig;
  }

  // Suggestion cache — invalidated when proofs, price, or unit change
  const EMPTY_SUGGESTIONS: QuickSendSuggestion[] = [];
  let sugCache: {
    sig: string;
    price: number;
    unit: string;
    result: QuickSendSuggestion[];
  } | null = null;

  function getSuggestions(): QuickSendSuggestion[] {
    if (!getSuggestionsEnabled() || suggestionsDisabled)
      return EMPTY_SUGGESTIONS;
    const unitNow = getUnit();
    const proofs = getProofAmounts();
    const price = getBtcPrice();
    // Fiat-unit suggestions are cent-exact and need no price; the sat
    // account still needs one for the display-currency chip category.
    if (proofs.length === 0) return EMPTY_SUGGESTIONS;
    if (unitNow === 'sat' && price <= 0) return EMPTY_SUGGESTIONS;

    const sig = proofSignature(proofs);
    if (
      sugCache &&
      sugCache.sig === sig &&
      sugCache.price === price &&
      sugCache.unit === unitNow
    ) {
      return sugCache.result;
    }

    const result = computeQuickSendSuggestions(proofs, price, {
      unit: unitNow,
      fiatCurrency: getFiatCurrency(),
      fiatSymbol: getFiatSymbol(),
      config: quickSendConfig ?? undefined,
    });
    // Logged so we can verify the "Send all" suggestion's amount matches the
    // actual sum of available proofs. Mismatches indicate the wallet's
    // proofAmounts cache is stale relative to coco's proof state.
    const sendAll = result.find((s) => s.sendAll);
    logger.info('amountActions.suggestion.derive', {
      proofCount: proofs.length,
      spendableTotal: proofs.reduce((a, b) => a + b, 0),
      unit: unitNow,
      displayedSendAll: sendAll?.amount.value ?? null,
    });
    sugCache = { sig, price, unit: unitNow, result };
    return result;
  }

  function notify(): void {
    // Don't invalidate `prevResolution` — `inspect()`'s structural-equal check
    // already promotes a new ref only when the resolution actually changed,
    // so notifying here without clearing the cache lets useSyncExternalStore
    // skip re-renders for setInput calls that produce structurally equal output.
    logger.debug('amountActions.notify', {
      listenerCount: listeners.size,
      inputMode,
      rawInputLength: rawInput.length,
    });
    for (const fn of listeners) fn();
  }

  function parseNumericValue(input: string): number {
    if (!input) return 0;
    const parsed = parseFloat(input);
    return isNaN(parsed) ? 0 : parsed;
  }

  /** The envelope max for the active unit, or null when uncapped. */
  function currentCap(): number | null {
    const envelope = getAmountEnvelope?.() ?? null;
    if (!envelope || envelope.maxAmount == null) return null;
    // A stale envelope for another unit must never clamp this one.
    if (envelope.unit !== getUnit().toLowerCase()) return null;
    return envelope.maxAmount > 0 ? envelope.maxAmount : null;
  }

  /** Minor-unit value the given raw string resolves to in the current mode. */
  function rawToMinor(input: string): number {
    const numericValue = parseNumericValue(input);
    if (numericValue <= 0) return 0;
    if (inputMode === 'fiat') {
      const btcPrice = getBtcPrice();
      if (btcPrice <= 0) return 0;
      return Math.round(numericValue * (SATS_PER_BTC / btcPrice));
    }
    return majorToMinor(numericValue, getUnit());
  }

  /** Render a minor-unit cap as a raw-input string for the current mode. */
  function capToRawInput(cap: number): string {
    if (inputMode === 'fiat') {
      const btcPrice = getBtcPrice();
      if (btcPrice <= 0) return '';
      // Floor to 2 decimals so the replacement never re-exceeds the cap.
      const fiat = Math.floor((cap / SATS_PER_BTC) * btcPrice * 100) / 100;
      return fiatToRawInput(fiat);
    }
    return minorToRawInput(cap, getUnit());
  }

  // compute() memo. inspect() is the useSyncExternalStore getSnapshot, so it
  // runs on EVERY render of the amount screen — and resolveAmount runs a
  // subset-sum composition synchronously on the JS thread. The structural
  // resolutionEqual check below only stabilizes the returned REFERENCE; this
  // memo skips the work itself when no input changed since the last call.
  let computeCache: { key: string; result: AmountResolution } | null = null;

  function compute(): AmountResolution {
    ensureUnitCurrent();
    const numericValue = parseNumericValue(rawInput);
    const mintUrl = getMintUrl();
    const allProofAmounts = getProofAmounts();
    const proofAmounts = mintUrl ? allProofAmounts : [];
    const btcPrice = getBtcPrice();
    const offlineOpt = getOfflineOptimization();
    const suggestionsOn = getSuggestionsEnabled();
    const unitNow = getUnit();
    const fiatCurrencyNow = getFiatCurrency();
    const fiatSymbolNow = getFiatSymbol();
    const fiatToggleAvailable = hasFiatToggleNow();
    const fiatToggleActive = fiatToggleAvailable && btcPrice > 0;

    // Keyed on the UNGATED proof set: getSuggestions() reads proofs even when
    // mintUrl is null, so gating the signature on mintUrl could serve a stale
    // suggestions list from the memo.
    const computeKey = [
      inputMode,
      rawInput,
      unitNow,
      mintUrl ?? '',
      proofSignature(allProofAmounts),
      btcPrice,
      offlineOpt,
      suggestionsOn,
      fiatCurrencyNow ?? '',
      fiatSymbolNow ?? '',
      clampedToCap,
      currentCap() ?? 'uncapped',
    ].join('§');
    if (computeCache && computeCache.key === computeKey) {
      return computeCache.result;
    }

    const core = resolveAmount({
      inputMode,
      rawInput,
      numericValue,
      unit: unitNow,
      proofAmounts,
      btcPrice,
      offlineOptimization: offlineOpt,
    });

    // Keyboard unit: display-currency code in fiat mode, unit code otherwise.
    // CustomKeyboard renders the 2-decimal keypad for any non-'sat' unit, so
    // fiat accounts get decimal entry with zero keyboard changes.
    const keyboardUnit =
      inputMode === 'fiat' && fiatCurrencyNow ? fiatCurrencyNow : unitNow;

    // Secondary "≈ …" line: sat account only. Fiat accounts show nothing —
    // the entered value IS the amount, there is no conversion to explain.
    const secondaryDisplay = fiatToggleActive
      ? formatSecondaryDisplay(
          inputMode,
          core.displayAmount,
          core.displayFiat,
          fiatSymbolNow!,
        )
      : null;

    const cap = currentCap();
    const inputCap: UnitAmount | null =
      cap != null ? { value: cap, unit: unitNow } : null;

    const suggestions = getSuggestions();
    const result: AmountResolution = {
      ...core,
      unit: unitNow,
      keyboardUnit,
      secondaryDisplay,
      fiatCurrency: fiatToggleActive ? fiatCurrencyNow! : null,
      fiatSymbol: fiatToggleActive ? fiatSymbolNow! : null,
      unitSymbol: symbolForUnit(unitNow),
      btcPrice,
      suggestions,
      clampedToCap,
      inputCap,
    };

    const proofTotal = sumAmounts(proofAmounts);
    const computeLogKey = JSON.stringify({
      inputMode: result.inputMode,
      rawInputLength: result.rawInput.length,
      numericValue: result.numericValue,
      effectiveAmountValue: result.effectiveAmount.value,
      effectiveAmountUnit: result.effectiveAmount.unit,
      displayAmount: result.displayAmount,
      displayFiat: result.displayFiat,
      autoOptimized: result.autoOptimized,
      canSendOffline: result.canSendOffline,
      unit: result.unit,
      keyboardUnit: result.keyboardUnit,
      btcPrice,
      offlineOpt,
      fiatToggleAvailable,
      fiatToggleActive,
      clampedToCap,
      inputCapValue: inputCap?.value ?? null,
      hasMintUrl: !!mintUrl,
      proofCount: proofAmounts.length,
      proofTotal,
      suggestionCount: suggestions.length,
    });
    if (computeLogKey !== prevComputeLogKey) {
      prevComputeLogKey = computeLogKey;
      logger.info('amountActions.compute.result', {
        inputMode: result.inputMode,
        rawInputLength: result.rawInput.length,
        numericValue: result.numericValue,
        effectiveAmountValue: result.effectiveAmount.value,
        effectiveAmountUnit: result.effectiveAmount.unit,
        displayAmount: result.displayAmount,
        hasDisplayFiat: result.displayFiat != null,
        displayFiat: result.displayFiat,
        autoOptimized: result.autoOptimized,
        canSendOffline: result.canSendOffline,
        unit: result.unit,
        keyboardUnit: result.keyboardUnit,
        hasSecondaryDisplay: result.secondaryDisplay != null,
        hasFiatCurrency: result.fiatCurrency != null,
        hasFiatSymbol: result.fiatSymbol != null,
        btcPrice,
        offlineOptimization: offlineOpt,
        fiatToggleAvailable,
        fiatToggleActive,
        clampedToCap,
        inputCapValue: inputCap?.value ?? null,
        hasMintUrl: !!mintUrl,
        mintUrlLength: mintUrl?.length ?? 0,
        proofCount: proofAmounts.length,
        proofTotal,
        suggestionCount: suggestions.length,
      });
    }

    computeCache = { key: computeKey, result };
    return result;
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
    ensureUnitCurrent();
    // Hard cap: replace (never silently reject) input that exceeds the
    // envelope max — CustomKeyboard resyncs its internal state only when its
    // `value` prop changes, so rejection would desync the keypad.
    const cap = currentCap();
    let next = input;
    let clamped = false;
    if (cap != null && rawToMinor(input) > cap) {
      next = capToRawInput(cap);
      clamped = true;
      logger.info('amount.input.clamped', {
        cap,
        unit: getUnit(),
        inputMode,
        rejectedLength: input.length,
      });
    }
    logger.info('amountActions.setInput', {
      previousRawInputLength: rawInput.length,
      nextRawInputLength: next.length,
      unchanged: next === rawInput,
      clamped,
      inputMode,
    });
    rawInput = next;
    clampedToCap = clamped;
    notify();
  };

  const setMode = (mode: AmountInputMode): void => {
    ensureUnitCurrent();
    if (mode === 'fiat' && !hasFiatToggleNow()) {
      logger.info('amountActions.setMode.skipped', {
        reason: 'fiat-toggle-unavailable',
        requestedMode: mode,
        inputMode,
        unit: getUnit(),
        rawInputLength: rawInput.length,
      });
      return;
    }
    if (mode === inputMode) {
      logger.debug('amountActions.setMode.skipped', {
        reason: 'already-selected',
        requestedMode: mode,
        inputMode,
        rawInputLength: rawInput.length,
      });
      return;
    }
    logger.info('amountActions.setMode.done', {
      previousMode: inputMode,
      nextMode: mode,
      rawInputLength: rawInput.length,
    });
    inputMode = mode;
    // Don't notify — caller will follow with setInput.
  };

  const toggle = (): void => {
    ensureUnitCurrent();
    if (!hasFiatToggleNow()) {
      logger.info('amountActions.toggle.skipped', {
        reason: 'fiat-toggle-unavailable',
        inputMode,
        unit: getUnit(),
        rawInputLength: rawInput.length,
      });
      return;
    }

    const btcPrice = getBtcPrice();
    if (btcPrice <= 0) {
      logger.info('amountActions.toggle.skipped', {
        reason: 'btc-price-unavailable',
        inputMode,
        rawInputLength: rawInput.length,
        btcPrice,
      });
      return;
    }

    const current = inspect();
    const previousMode = inputMode;

    if (inputMode === 'unit') {
      // sat → fiat: convert current sats to fiat display value
      inputMode = 'fiat';
      if (
        current.numericValue > 0 &&
        current.displayFiat != null &&
        current.displayFiat > 0
      ) {
        rawInput = fiatToRawInput(current.displayFiat);
      } else {
        rawInput = '';
      }
    } else {
      // fiat → sat: use the effective (possibly auto-optimized) sat amount
      inputMode = 'unit';
      if (current.effectiveAmount.value > 0) {
        rawInput = String(current.effectiveAmount.value);
      } else {
        rawInput = '';
      }
    }
    logger.info('amountActions.toggle.done', {
      previousMode,
      nextMode: inputMode,
      previousRawInputLength: current.rawInput.length,
      nextRawInputLength: rawInput.length,
      btcPrice,
      effectiveAmountValue: current.effectiveAmount.value,
      hasDisplayFiat: current.displayFiat != null,
      displayFiat: current.displayFiat,
    });
    notify();
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    logger.debug('amountActions.subscribe', {
      listenerCount: listeners.size,
    });
    return () => {
      listeners.delete(listener);
      logger.debug('amountActions.unsubscribe', {
        listenerCount: listeners.size,
      });
    };
  };

  return { setInput, setMode, toggle, inspect, subscribe };
}
