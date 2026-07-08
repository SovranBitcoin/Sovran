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
import { z } from 'zod';
import { TransactionsScreen, useTransactionsFilter } from '@/features/transactions';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { withGlassHeaderItems } from '@/navigation/headerItems';
import { HistoryEntry } from '@cashu/coco-core';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { navigateToTransactionDetail } from '@/shared/lib/nav/transactionDetailRoutes';
import opacity from 'hex-color-opacity';
import { cashuLog } from '@/shared/lib/logger';

const ParamsSchema = z.object({
  filterCurrency: z.string().max(16).optional(),
  filterPaymentType: z.enum(['all', 'lightning', 'ecash', 'onchain']).optional(),
  filterDirection: z.enum(['all', 'incoming', 'outgoing']).optional(),
  filterStatus: z.enum(['All', 'Confirmed', 'Pending', 'Expired']).optional(),
  filterMintUrl: z.string().max(2048).optional(),
  filterSource: z.enum(['all', 'qr', 'nfc', 'ble', 'paste', 'deeplink']).optional(),
  filterLock: z.enum(['all', 'locked', 'unlocked']).optional(),
  filterCounterparty: z.enum(['all', 'with']).optional(),
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
    source,
    lock,
    counterparty,
    selectedMonth,
    setSelectedMonth,
    setCurrency,
    setPaymentType,
    setDirection,
    setStatus,
    setMintUrl,
    setSource,
    setLock,
    setCounterparty,
  } = useTransactionsFilter();

  const filterCurrency = params?.filterCurrency;
  const filterPaymentType = params?.filterPaymentType;
  const filterDirection = params?.filterDirection;
  const filterStatus = params?.filterStatus;
  const filterMintUrl = params?.filterMintUrl;
  const filterSource = params?.filterSource;
  const filterLock = params?.filterLock;
  const filterCounterparty = params?.filterCounterparty;

  // Sync filter params from URL to context (when returning from filter flow)
  React.useEffect(() => {
    const activeParamKeys = [
      filterCurrency ? 'filterCurrency' : null,
      filterPaymentType ? 'filterPaymentType' : null,
      filterDirection ? 'filterDirection' : null,
      filterStatus ? 'filterStatus' : null,
      filterMintUrl ? 'filterMintUrl' : null,
    ].filter(Boolean);
    if (activeParamKeys.length > 0) {
      cashuLog.info('transactions.route.filters.apply', {
        activeParamKeys,
        filterPaymentType: filterPaymentType ?? null,
        filterDirection: filterDirection ?? null,
        filterStatus: filterStatus ?? null,
        hasFilterCurrency: !!filterCurrency,
        hasFilterMintUrl: !!filterMintUrl,
      });
    }
    if (filterCurrency) setCurrency(filterCurrency);
    if (filterPaymentType) setPaymentType(filterPaymentType);
    if (filterDirection) setDirection(filterDirection);
    if (filterStatus) setStatus(filterStatus);
    if (filterMintUrl) setMintUrl(filterMintUrl);
    if (filterSource) setSource(filterSource);
    if (filterLock) setLock(filterLock);
    if (filterCounterparty) setCounterparty(filterCounterparty);
  }, [
    filterCurrency,
    filterPaymentType,
    filterDirection,
    filterStatus,
    filterMintUrl,
    filterSource,
    filterLock,
    filterCounterparty,
    setCurrency,
    setPaymentType,
    setDirection,
    setStatus,
    setMintUrl,
    setSource,
    setLock,
    setCounterparty,
  ]);

  // Handle transaction press — declared before the early-return so the hook
  // order stays stable across renders.
  const handleTransactionPress = useCallback((historyEntry: HistoryEntry) => {
    navigateToTransactionDetail(historyEntry, 'transactions.route');
  }, []);

  if (!params) return null;

  return (
    <>
      {/* Native header - transparent with filter button */}
      <Stack.Screen
        options={withGlassHeaderItems({
          title: 'Transactions',
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          headerRight: () => <FilterButton />,
        })}
      />

      <TransactionsScreen
        initialTab={status}
        onTransactionPress={handleTransactionPress}
        filterCurrency={currency}
        filterPaymentType={paymentType}
        filterDirection={direction}
        filterMintUrl={mintUrl}
        filterSource={source}
        filterLock={lock}
        filterCounterparty={counterparty}
        filterMonth={selectedMonth}
        onMonthChange={setSelectedMonth}
      />
    </>
  );
}

export default TransactionsRoute;
