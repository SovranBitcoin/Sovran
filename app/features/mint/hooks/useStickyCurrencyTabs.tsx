/**
 * Sticky currency-tab header wiring shared by the mint screens (list,
 * distribution, add): the `scrollY` shared value driving the large→small tab
 * shrink, the scroll handler feeding it, the pinned `MintCurrencyTabs`
 * element for `Screen stickyContent`, and the spacer reserving the nav+tabs
 * band reported via `onHeaderHeightChange`.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { MintCurrencyTabs } from '../components/MintCurrencyTabs';

export function useStickyCurrencyTabs({
  currencies,
  selectedCurrency,
  onCurrencyChange,
}: {
  currencies: string[];
  selectedCurrency: string;
  onCurrencyChange: (currency: string) => void;
}): {
  scrollY: SharedValue<number>;
  totalHeaderHeight: number;
  setTotalHeaderHeight: (height: number) => void;
  handleScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  currencyTabs: React.ReactElement;
  headerSpacer: React.ReactElement;
} {
  const scrollY = useSharedValue(0);
  const [totalHeaderHeight, setTotalHeaderHeight] = useState(0);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.value = Math.max(0, event.nativeEvent.contentOffset.y);
    },
    [scrollY]
  );

  const currencyTabs = useMemo(
    () => (
      <MintCurrencyTabs
        currencies={currencies}
        selectedCurrency={selectedCurrency}
        onCurrencyChange={onCurrencyChange}
        scrollY={scrollY}
      />
    ),
    [currencies, selectedCurrency, onCurrencyChange, scrollY]
  );

  // Reserves the full header height (nav + sticky tabs). The wrapper derives
  // that from a frame-0-stable value on iOS, so this spacer does not reflow.
  const headerSpacer = useMemo(
    () => <View style={{ height: totalHeaderHeight }} />,
    [totalHeaderHeight]
  );

  return {
    scrollY,
    totalHeaderHeight,
    setTotalHeaderHeight,
    handleScroll,
    currencyTabs,
    headerSpacer,
  };
}
