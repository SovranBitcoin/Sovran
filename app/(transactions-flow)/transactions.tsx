/**
 * @fileoverview Transactions flow entry screen
 *
 * Part of the (transactions-flow) modal group.
 * Clicking on a transaction navigates horizontally within the modal.
 * Uses native header with liquid glass buttons.
 * Includes filter button in header right that opens filter sheet.
 *
 * Validates the deep-link `account` (JSON-encoded) and `filter*` params
 * at the route boundary per AUDIT.md dim-5 — `account` is fed to
 * JSON.parse, the filter strings are downcast to closed unions.
 */

import React, { useCallback } from 'react';
import { TouchableOpacity } from 'react-native';
import { router, Stack } from 'expo-router';
import { z } from 'zod';
import { TransactionsScreen, useTransactionsFilter } from '@/features/transactions';
import { HistoryEntry, ReceiveHistoryEntry } from '@cashu/coco-core';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import opacity from 'hex-color-opacity';

const ParamsSchema = z.object({
  account: z.string().min(1).max(64_000).optional(),
  filterCurrency: z.string().max(16).optional(),
  filterPaymentType: z.enum(['all', 'lightning', 'ecash']).optional(),
  filterDirection: z.enum(['all', 'incoming', 'outgoing']).optional(),
  filterStatus: z.enum(['All', 'Confirmed', 'Pending', 'Expired']).optional(),
  filterMintUrl: z.string().max(2048).optional(),
});

function FilterButton() {
  const [foreground, accent, accentForeground] = useThemeColor([
    'foreground',
    'accent',
    'accent-foreground',
  ] as const);
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
              color: accentForeground,
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
  const params = useRouteParams(ParamsSchema, { where: 'transactions-flow.transactions' });
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

  const filterCurrency = params?.filterCurrency;
  const filterPaymentType = params?.filterPaymentType;
  const filterDirection = params?.filterDirection;
  const filterStatus = params?.filterStatus;
  const filterMintUrl = params?.filterMintUrl;

  // Sync filter params from URL to context (when returning from filter flow)
  React.useEffect(() => {
    if (filterCurrency) setCurrency(filterCurrency);
    if (filterPaymentType) setPaymentType(filterPaymentType);
    if (filterDirection) setDirection(filterDirection);
    if (filterStatus) setStatus(filterStatus);
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

  // Handle transaction press — declared before the early-return so the hook
  // order stays stable across renders.
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

  if (!params) return null;

  const initialAccount = params.account ? JSON.parse(params.account) : undefined;

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

export default TransactionsRoute;
