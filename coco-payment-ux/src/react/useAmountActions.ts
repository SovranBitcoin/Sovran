// ---------------------------------------------------------------------------
// useAmountActions — React hook for the AmountActionManager
//
// Creates a stable manager via useMemo and subscribes to state via
// useSyncExternalStore. Returns a flat object merging the resolution
// state with action methods so consuming code can do:
//
//   const amount = useAmountActions({ ... });
//   amount.toggle();           // toggle fiat/sat
//   amount.setInput("42");     // forward keyboard input
//   amount.rawInput;           // "42"
//   amount.keyboardUnit;       // "sat"
//   amount.secondaryDisplay;   // "≈ $0.02"
//   amount.effectiveSatAmount; // 42
//   amount.canSendOffline;     // true
// ---------------------------------------------------------------------------

import { useMemo, useRef, useSyncExternalStore } from 'react';

import { createAmountActionManager } from '../amount-actions/createManager';
import type { AmountResolution } from '../amount-actions/types';

export interface UseAmountActionsConfig {
  /** Currently selected mint URL. */
  mintUrl: string | undefined;
  /** Proof amounts for the selected mint. */
  proofAmounts: number[];
  /** Current BTC price in user's fiat currency. */
  btcPrice: number;
  /**
   * Whether offline proof analysis and fiat-window optimization apply.
   * Typically true for ecash sends, false for receive/melt flows.
   */
  offlineOptimization: boolean;
  /** Base unit for sat mode (e.g. 'sat'). */
  unit: string;
  /** Fiat currency code (e.g. 'usd'). Enables fiat toggle when provided with fiatSymbol. */
  fiatCurrency?: string;
  /** Fiat currency symbol (e.g. '$'). Enables fiat toggle when provided with fiatCurrency. */
  fiatSymbol?: string;
}

export type UseAmountActionsResult = AmountResolution & {
  /** Set the raw input string (forward from CustomKeyboard's onKeyPress). */
  setInput: (rawInput: string) => void;
  /** Toggle between sat and fiat input modes. */
  toggle: () => void;
};

/**
 * Creates and subscribes to an AmountActionManager.
 *
 * The manager is created once and reads the latest values through refs.
 * External state changes (mintUrl, proofAmounts, btcPrice) are picked up
 * on the next inspect() call — useSyncExternalStore's torn-read recovery
 * ensures the component re-renders when the resolved state changes.
 */
export function useAmountActions(config: UseAmountActionsConfig): UseAmountActionsResult {
  const {
    mintUrl,
    proofAmounts,
    btcPrice,
    offlineOptimization,
    unit,
    fiatCurrency,
    fiatSymbol,
  } = config;

  // Refs keep the manager's getters up to date without recreation
  const mintUrlRef = useRef(mintUrl);
  const proofAmountsRef = useRef(proofAmounts);
  const btcPriceRef = useRef(btcPrice);
  mintUrlRef.current = mintUrl;
  proofAmountsRef.current = proofAmounts;
  btcPriceRef.current = btcPrice;

  const manager = useMemo(
    () =>
      createAmountActionManager({
        getMintUrl: () => mintUrlRef.current,
        getProofAmounts: () => proofAmountsRef.current,
        getBtcPrice: () => btcPriceRef.current,
        offlineOptimization,
        unit,
        fiatCurrency,
        fiatSymbol,
      }),
    [offlineOptimization, unit, fiatCurrency, fiatSymbol]
  );

  const resolution = useSyncExternalStore(manager.subscribe, manager.inspect, manager.inspect);

  return {
    ...resolution,
    setInput: manager.setInput,
    toggle: manager.toggle,
  };
}
