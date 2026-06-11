/**
 * @fileoverview Transactions flow entry screen
 *
 * Part of the (transactions-flow) modal group.
 * Clicking on a transaction navigates horizontally within the modal.
 * Uses native header with liquid glass buttons.
 * Includes filter button in header right that opens filter sheet.
 *
 * Validates the deep-link `filter*` params at the route boundary per
 * AUDIT.md dim-5 — strings are downcast to closed unions.
 */

import React, { useCallback } from 'react';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { z } from 'zod';
import { TransactionsScreen, useTransactionsFilter } from '@/features/transactions';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { HistoryEntry, ReceiveHistoryEntry } from '@cashu/coco-core';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import {
  getMeltDetailPathname,
  getMintDetailPathname,
} from '@/shared/lib/nav/transactionDetailRoutes';
import opacity from 'hex-color-opacity';

const ParamsSchema = z.object({
  filterCurrency: z.string().max(16).optional(),
  filterPaymentType: z.enum(['all', 'lightning', 'ecash', 'onchain']).optional(),
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
    <ScreenHeaderAction
      icon="fluent:filter-16-filled"
      size={22}
      color={hasActiveFilters ? opacity(foreground, 0.4) : foreground}
      onPress={openFilterSheet}
      accessory={
        hasActiveFilters ? (
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
        ) : undefined
      }
    />
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
          pathname: getMintDetailPathname(historyEntry),
          params: {
            mintHistoryEntry: JSON.stringify(historyEntry),
          },
        });
        return;
      }
      case 'melt': {
        router.navigate({
          pathname: getMeltDetailPathname(historyEntry),
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
