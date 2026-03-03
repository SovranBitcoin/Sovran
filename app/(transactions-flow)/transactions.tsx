/**
 * @fileoverview Transactions flow entry screen
 *
 * Part of the (transactions-flow) modal group.
 * Clicking on a transaction navigates horizontally within the modal.
 * Uses native header with liquid glass buttons.
 * Includes filter button in header right that opens filter sheet.
 */

import React, { useCallback } from 'react';
import { TouchableOpacity } from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { TransactionsScreen, useTransactionsFilter } from '@/features/transactions';
import { HistoryEntry, ReceiveHistoryEntry } from 'coco-cashu-core';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';

function FilterButton() {
  const [foreground, accent] = useThemeColor(['foreground', 'accent'] as const);
  const { openFilterSheet, hasActiveFilters, activeFilterCount } = useTransactionsFilter();

  return (
    <TouchableOpacity onPress={openFilterSheet} className="relative p-2">
      <Icon
        name="fluent:filter-16-filled"
        size={22}
        color={hasActiveFilters ? opacity(foreground, 0.4) : foreground}
      />
      {hasActiveFilters && (
        <View
          className="absolute right-1 top-1 h-4 min-w-4 items-center justify-center rounded-[10px]"
          style={{ backgroundColor: accent }}>
          <Text
            size={10}
            style={{
              color: foreground,
              fontFamily: 'OxygenBold',
            }}>
            {activeFilterCount}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function TransactionsRoute() {
  const {
    account,
    filterCurrency,
    filterPaymentType,
    filterDirection,
    filterStatus,
    filterMintUrl,
  } = useLocalSearchParams<{
    account: string;
    filterCurrency?: string;
    filterPaymentType?: string;
    filterDirection?: string;
    filterStatus?: string;
    filterMintUrl?: string;
  }>();
  const {
    currency,
    paymentType,
    direction,
    status,
    mintUrl,
    selectedMonth,
    setSelectedMonth,
    setCurrency,
    setPaymentType,
    setDirection,
    setStatus,
    setMintUrl,
  } = useTransactionsFilter();

  // Sync filter params from URL to context (when returning from filter flow)
  React.useEffect(() => {
    if (filterCurrency) setCurrency(filterCurrency);
    if (filterPaymentType) setPaymentType(filterPaymentType as 'all' | 'lightning' | 'ecash');
    if (filterDirection) setDirection(filterDirection as 'all' | 'incoming' | 'outgoing');
    if (filterStatus) setStatus(filterStatus as 'All' | 'Confirmed' | 'Pending' | 'Expired');
    if (filterMintUrl) setMintUrl(filterMintUrl);
  }, [
    filterCurrency,
    filterPaymentType,
    filterDirection,
    filterStatus,
    filterMintUrl,
    setCurrency,
    setPaymentType,
    setDirection,
    setStatus,
    setMintUrl,
  ]);

  const initialAccount = account ? JSON.parse(account) : undefined;

  // Handle transaction press
  const handleTransactionPress = useCallback((historyEntry: HistoryEntry) => {
    switch (historyEntry.type) {
      case 'mint': {
        router.navigate({
          pathname: '/mintQuote',
          params: {
            mintHistoryEntry: JSON.stringify(historyEntry),
          },
        });
        return;
      }
      case 'melt': {
        router.navigate({
          pathname: '/meltQuote',
          params: {
            meltHistoryEntry: JSON.stringify(historyEntry),
          },
        });
        return;
      }
      case 'send': {
        router.navigate({
          pathname: '/sendToken',
          params: {
            sendHistoryEntry: JSON.stringify(historyEntry),
          },
        });
        return;
      }
      case 'receive': {
        router.navigate({
          pathname: '/receiveToken',
          params: {
            receiveHistoryEntry: JSON.stringify(historyEntry as ReceiveHistoryEntry),
          },
        });
        return;
      }
    }
  }, []);

  return (
    <>
      {/* Native header - transparent with filter button */}
      <Stack.Screen
        options={{
          title: 'Transactions',
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          headerRight: () => <FilterButton />,
        }}
      />

      <TransactionsScreen
        initialAccount={initialAccount}
        initialTab={status}
        onTransactionPress={handleTransactionPress}
        filterCurrency={currency}
        filterPaymentType={paymentType}
        filterDirection={direction}
        filterMintUrl={mintUrl}
        filterMonth={selectedMonth}
        onMonthChange={setSelectedMonth}
      />
    </>
  );
}

export default withSheetProvider(TransactionsRoute);
