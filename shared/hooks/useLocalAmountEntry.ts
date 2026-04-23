/**
 * Local-state amount entry with sat/fiat toggle.
 *
 * For screens that need the same sat/fiat input UX as the send/receive flow
 * but without the coco-payment-ux payment machine (no mint, no proofs, no
 * paste/scan/next-machine-action). Reuses `createAmountActionManager` for
 * the conversion math, toggle behaviour, secondary-display formatting, and
 * keyboard-unit computation, so numeric behaviour stays byte-identical to
 * the machine-driven path.
 *
 * Sources `displayCurrency` from `useSettingsStore` and `btcPrice` from
 * `usePricelistStore`, so changing either flows through automatically.
 */

import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { createAmountActionManager } from 'coco-payment-ux';

import { useSettingsStore, type DisplayCurrency } from '@/shared/stores/global/settingsStore';
import { usePricelistStore } from '@/shared/stores/global/pricelistStore';

const FIAT_SYMBOLS: Record<DisplayCurrency, string> = {
  usd: '$',
  eur: '€',
  gbp: '£',
};

export interface UseLocalAmountEntryOptions {
  /** Base unit for sat mode. Defaults to 'sat'. */
  unit?: string;
}

export interface UseLocalAmountEntryResult {
  rawInput: string;
  inputMode: 'sat' | 'fiat';
  numericValue: number;
  unit: string;
  keyboardUnit: string;
  secondaryDisplay: string | null;
  fiatSymbol: string | null;
  /** Satoshi amount to submit to downstream flows (honours fiat rounding). */
  effectiveSatAmount: number;
  onKeyPress: (value: string) => void;
  onToggleMode: () => void;
}

export function useLocalAmountEntry(
  options: UseLocalAmountEntryOptions = {}
): UseLocalAmountEntryResult {
  const unit = options.unit ?? 'sat';

  // Reactive so a currency change in settings recreates the manager below.
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const fiatSymbol = FIAT_SYMBOLS[displayCurrency];

  // Kept in a ref so the manager's getBtcPrice() reads fresh values without
  // forcing a manager rebuild on every price tick.
  const priceRef = useRef(0);
  priceRef.current = usePricelistStore((s) => s.getBtcPrice(displayCurrency)) ?? 0;

  const manager = useMemo(
    () =>
      createAmountActionManager({
        getMintUrl: () => undefined,
        getProofAmounts: () => [],
        getBtcPrice: () => priceRef.current,
        offlineOptimization: false,
        unit,
        fiatCurrency: displayCurrency,
        fiatSymbol,
        quickSendConfig: null,
      }),
    [unit, displayCurrency, fiatSymbol]
  );

  // The manager only fires its own listeners on setInput/toggle. Price ticks
  // arrive through the pricelist store; fan them into the same listener so
  // `secondaryDisplay` refreshes without requiring a keypress.
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubManager = manager.subscribe(listener);
      const unsubPrice = usePricelistStore.subscribe(listener);
      return () => {
        unsubManager();
        unsubPrice();
      };
    },
    [manager]
  );

  const resolution = useSyncExternalStore(subscribe, manager.inspect, manager.inspect);

  const onKeyPress = useCallback(
    (value: string) => {
      manager.setInput(value);
    },
    [manager]
  );

  const onToggleMode = useCallback(() => {
    manager.toggle();
  }, [manager]);

  return {
    rawInput: resolution.rawInput,
    inputMode: resolution.inputMode,
    numericValue: resolution.numericValue,
    unit: resolution.unit,
    keyboardUnit: resolution.keyboardUnit,
    secondaryDisplay: resolution.secondaryDisplay,
    fiatSymbol: resolution.fiatSymbol,
    effectiveSatAmount: resolution.effectiveSatAmount,
    onKeyPress,
    onToggleMode,
  };
}
