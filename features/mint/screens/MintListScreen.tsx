/**
 * @fileoverview Shared Mint List screen component
 *
 * Pure display component — receives a pre-built MintListItem[] and renders it.
 * All data fetching (balances, KYM scores, audit data, availability) is done
 * before navigation via machine operations in CocoPaymentUX.tsx.
 *
 * The only local state is the selected currency tab.
 */

import React, { memo, useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useSharedValue } from 'react-native-reanimated';
import { LegendList, type NativeScrollEvent, type NativeSyntheticEvent } from '@legendapp/list';

import type { MintListItem } from 'coco-payment-ux';

import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import opacity from 'hex-color-opacity';
import { ContactRow, mintIdentity } from '@/shared/ui/composed/ContactRow';
import { MintCurrencyTabs } from '@/features/mint/components/MintCurrencyTabs';
import { Screen } from '@/shared/ui/composed/Screen';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { cashuLog, useLifecycleLogger } from '@/shared/lib/logger';

const CURRENCY_TABS_HEIGHT = 48;

interface MintListScreenProps {
  /** Pre-built mint rows from buildMintListItems(). Already sorted and availability-annotated. */
  items: MintListItem[];
  /** When true, all rows show a global loading state (a handler is executing). */
  isExecuting?: boolean;
  /** Whether to show the details/inspect button on each mint (default: true) */
  showDetailsButton?: boolean;
  /** Label for close/cancel button (default: "Close") */
  closeButtonLabel?: string;
  /** Called when a selectable mint is tapped */
  onMintSelect: (item: MintListItem) => void;
  /** Called when inspect/details button is pressed on a mint */
  onInspectMint?: (mintUrl: string) => void;
  /** Called when close/cancel button is pressed */
  onClose: () => void;
}

function getMintDisabledReasonLabel(reason: MintListItem['reason']): string | null {
  return reason?.message ?? null;
}

export const MintListScreen = memo(function MintListScreen({
  items,
  isExecuting = false,
  showDetailsButton = true,
  closeButtonLabel = 'Close',
  onMintSelect,
  onInspectMint,
  onClose,
}: MintListScreenProps) {
  useLifecycleLogger('MintListScreen', cashuLog);

  const [foreground, surface] = useThemeColor(['foreground', 'surface'] as const);
  const scrollY = useSharedValue(0);
  const [totalHeaderHeight, setTotalHeaderHeight] = useState(0);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('ALL');

  const prevRenderKey = useRef('');
  const renderKey = `${items.length}:${isExecuting}`;
  useEffect(() => {
    if (renderKey !== prevRenderKey.current) {
      prevRenderKey.current = renderKey;
      cashuLog.debug('mint.list.render', { itemCount: items.length, isExecuting });
    }
  });

  // Derive available currencies from items (no mint metadata needed — unit is in the item)
  const availableCurrencies = useMemo(() => {
    const units = [...new Set(items.map((item) => item.unit.toUpperCase()))];
    return ['ALL', ...units];
  }, [items]);

  // Filter by selected currency tab
  const filteredItems = useMemo(() => {
    if (selectedCurrency === 'ALL') return items;
    return items.filter((item) => item.unit.toUpperCase() === selectedCurrency);
  }, [items, selectedCurrency]);

  const handleCurrencyChange = useCallback((currency: string) => {
    cashuLog.info('mint.list.currency.change', { currency });
    setSelectedCurrency(currency);
  }, []);

  const handleMintPress = useCallback(
    (item: MintListItem) => {
      if (isExecuting || item.status !== 'available') {
        cashuLog.debug('mint.list.select.blocked', {
          mintUrl: item.mintUrl,
          isExecuting,
          status: item.status,
        });
        return;
      }
      cashuLog.info('mint.list.select', { mintUrl: item.mintUrl, unit: item.unit });
      onMintSelect(item);
    },
    [isExecuting, onMintSelect]
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.value = Math.max(0, event.nativeEvent.contentOffset.y);
    },
    [scrollY]
  );

  const currencyTabs = useMemo(
    () => (
      <MintCurrencyTabs
        currencies={availableCurrencies}
        selectedCurrency={selectedCurrency}
        onCurrencyChange={handleCurrencyChange}
        scrollY={scrollY}
      />
    ),
    [availableCurrencies, selectedCurrency, handleCurrencyChange, scrollY]
  );

  const listHeader = useMemo(
    () => <View style={{ height: totalHeaderHeight }} />,
    [totalHeaderHeight]
  );

  const emptyComponent = useMemo(
    () => (
      <Text style={{ color: opacity(foreground, 0.66), textAlign: 'center', marginTop: 20 }}>
        {selectedCurrency === 'ALL'
          ? 'No mints available'
          : `No mints available for ${selectedCurrency === 'SAT' ? 'BTC' : selectedCurrency}`}
      </Text>
    ),
    [selectedCurrency, foreground]
  );

  const bottomButtons = useMemo(
    () => (
      <BottomButtons>
        <ButtonHandler
          buttons={[
            {
              text: closeButtonLabel,
              variant: 'secondary' as const,
              onPress: async () => onClose(),
            },
          ]}
        />
      </BottomButtons>
    ),
    [closeButtonLabel, onClose]
  );

  const renderItem = useCallback(
    ({ item }: { item: MintListItem }) => (
      <ContactRow
        identity={mintIdentity(item)}
        disabled={isExecuting || item.status !== 'available'}
        disabledReason={getMintDisabledReasonLabel(item.reason) ?? undefined}
        trailingVariant={showDetailsButton ? undefined : 'none'}
        onPress={() => handleMintPress(item)}
        onInspectPress={
          showDetailsButton && onInspectMint ? () => onInspectMint(item.mintUrl) : undefined
        }
        testID={`contact-row:mint:${item.mintUrl}`}
      />
    ),
    [isExecuting, showDetailsButton, handleMintPress, onInspectMint]
  );

  return (
    <Screen
      name="MintListScreen"
      headerGradient
      stickyContent={currencyTabs}
      stickyContentHeight={CURRENCY_TABS_HEIGHT}
      scroll="custom"
      onHeaderHeightChange={setTotalHeaderHeight}
      footer={bottomButtons}
      bgColor={surface}>
      <LegendList
        data={filteredItems}
        renderItem={renderItem}
        keyExtractor={(item) => item.mintUrl}
        extraData={isExecuting}
        estimatedItemSize={120}
        drawDistance={300}
        style={{ flex: 1, height: 0 }}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 120 }}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={emptyComponent}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      />
    </Screen>
  );
});
