/**
 * @fileoverview Transactions flow entry screen
 *
 * Part of the (transactions-flow) modal group.
 * Clicking on a transaction navigates horizontally within the modal.
 * Uses native header with liquid glass buttons.
 * Includes filter button in header right that opens filter sheet.
 *
 * Validates the deep-link `filter*` params at the route boundary per
 * AUDIT.md dim-5 — strings are downcast to closed unions
 * (`TransactionsRouteParamsSchema`).
 */

import React, { useCallback } from 'react';
import { Stack } from 'expo-router';
import {
  TransactionsScreen,
  countActiveFilters,
  filtersFromTransactionsParams,
  mergeTransactionFilters,
  TransactionsRouteParamsSchema,
  useTransactionsFilter,
} from '@/features/transactions';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { withGlassHeaderItems } from '@/navigation/headerItems';
import { HistoryEntry } from '@cashu/coco-core';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { navigateToTransactionDetail } from '@/shared/lib/nav/transactionDetailRoutes';
import { withAlpha } from '@/shared/lib/color';
import { cashuLog } from '@/shared/lib/logger';

function FilterButton({ activeFilterCount }: { activeFilterCount: number }) {
  const [foreground, accent, accentForeground] = useThemeColor([
    'foreground',
    'accent',
    'accent-foreground',
  ] as const);
  const { openFilterSheet } = useTransactionsFilter();
  const hasActiveFilters = activeFilterCount > 0;

  return (
    <ScreenHeaderAction
      icon="fluent:filter-16-filled"
      size={22}
      color={hasActiveFilters ? withAlpha(foreground, 0.4) : foreground}
      onPress={openFilterSheet}
      testID="transactions-filter-open"
      accessibilityLabel="Open transaction filters"
      accessory={
        hasActiveFilters ? (
          <View
            className="absolute right-1 top-1 h-4 min-w-4 items-center justify-center rounded-[10px]"
            style={{ backgroundColor: accent }}>
            <Text size={10} bold color={accentForeground}>
              {activeFilterCount}
            </Text>
          </View>
        ) : undefined
      }
    />
  );
}

function TransactionsRoute() {
  const params = useRouteParams(TransactionsRouteParamsSchema, {
    where: 'transactions-flow.transactions',
  });
  const { filters, updateFilters, selectedMonth, setSelectedMonth } = useTransactionsFilter();

  // Sync filter params from URL to context (when returning from filter flow)
  const filterCurrency = params?.filterCurrency;
  const filterPaymentType = params?.filterPaymentType;
  const filterDirection = params?.filterDirection;
  const filterStatus = params?.filterStatus;
  const filterMintUrl = params?.filterMintUrl;
  const filterSource = params?.filterSource;
  const filterLock = params?.filterLock;
  const filterCounterparty = params?.filterCounterparty;
  const filterZap = params?.filterZap;
  const routeChanges = React.useMemo(
    () =>
      filtersFromTransactionsParams({
        filterCurrency,
        filterPaymentType,
        filterDirection,
        filterStatus,
        filterMintUrl,
        filterSource,
        filterLock,
        filterCounterparty,
        filterZap,
      }),
    [
      filterCurrency,
      filterPaymentType,
      filterDirection,
      filterStatus,
      filterMintUrl,
      filterSource,
      filterLock,
      filterCounterparty,
      filterZap,
    ]
  );
  // The route's params are the only writer of the shared filters, so the
  // filters with them applied are what the effect below is about to store.
  // Drawing that now keeps the first frame (and the frame after each visit)
  // from showing the previous filters — sats and `All` on a fresh open.
  const shownFilters = mergeTransactionFilters(filters, routeChanges);
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
    updateFilters(routeChanges);
  }, [
    routeChanges,
    filterCurrency,
    filterPaymentType,
    filterDirection,
    filterStatus,
    filterMintUrl,
    updateFilters,
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
          headerRight: () => <FilterButton activeFilterCount={countActiveFilters(shownFilters)} />,
        })}
      />

      <TransactionsScreen
        filters={shownFilters}
        onTransactionPress={handleTransactionPress}
        filterMonth={selectedMonth}
        onMonthChange={setSelectedMonth}
      />
    </>
  );
}

export default TransactionsRoute;
