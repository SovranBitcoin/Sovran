/**
 * @fileoverview Shared Transactions screen component
 *
 * This module provides the core UI and logic for the transactions list.
 * It is used by both standalone and flow-based route wrappers.
 *
 * Features:
 * - Custom collapsing header with Revolut-style large/small title animation
 * - Revolut-style month selector below header
 * - Filter support via external props (from filter flow)
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View } from 'components/ui/View';
import { Transactions } from 'components/blocks/Transactions';
import { MonthSelector } from 'components/blocks/MonthSelector';
import { CollapsingHeader, useCollapsingHeader } from 'components/blocks/CollapsingHeader';
import { HistoryEntry } from 'coco-cashu-core';
import { usePaginatedHistory } from 'coco-cashu-react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type StatusTab = 'All' | 'Confirmed' | 'Pending' | 'Expired';
type PaymentType = 'all' | 'lightning' | 'ecash';
type Direction = 'all' | 'incoming' | 'outgoing';

export interface TransactionsScreenProps {
  initialAccount?: { unit: string };
  initialTab?: StatusTab;
  /** Called when a transaction is tapped - used for flow-aware navigation */
  onTransactionPress?: (historyEntry: HistoryEntry) => void;
  /** External filter: currency (from filter flow) */
  filterCurrency?: string;
  /** External filter: payment type (from filter flow) */
  filterPaymentType?: PaymentType;
  /** External filter: direction (from filter flow) */
  filterDirection?: Direction;
  /** External filter: selected month key (format: "YYYY-MM") */
  filterMonth?: string | null;
  /** Callback when month selection changes */
  onMonthChange?: (month: string | null) => void;
  /** Left header button (e.g., close/back) */
  headerLeft?: React.ReactNode;
  /** Right header button (e.g., filter) */
  headerRight?: React.ReactNode;
}

export function TransactionsScreen({
  initialAccount,
  initialTab = 'All',
  onTransactionPress,
  filterCurrency,
  filterPaymentType = 'all',
  filterDirection = 'all',
  filterMonth,
  onMonthChange,
  headerLeft,
  headerRight,
}: TransactionsScreenProps) {
  const insets = useSafeAreaInsets();
  const { scrollY, scrollHandler } = useCollapsingHeader();

  // Use external filter props if provided, otherwise use internal state
  const selectedCurrency = filterCurrency || initialAccount?.unit || 'sat';
  const paymentType = filterPaymentType;
  const direction = filterDirection;
  const tab = initialTab; // Status tab now comes from filter flow

  // Internal state for month selection if no external handler provided
  const [internalMonth, setInternalMonth] = useState<string | null>(null);
  const selectedMonth = filterMonth !== undefined ? filterMonth : internalMonth;
  const handleMonthChange = onMonthChange || setInternalMonth;

  const getCocoTransactionTypes = useCallback((): HistoryEntry['type'][] => {
    if (paymentType === 'all' && direction === 'all') {
      return ['mint', 'melt', 'send', 'receive'];
    }

    if (paymentType === 'lightning') {
      if (direction === 'all') return ['mint', 'melt'];
      if (direction === 'incoming') return ['mint'];
      if (direction === 'outgoing') return ['melt'];
    }

    if (paymentType === 'ecash') {
      if (direction === 'all') return ['send', 'receive'];
      if (direction === 'incoming') return ['receive'];
      if (direction === 'outgoing') return ['send'];
    }

    if (paymentType === 'all') {
      if (direction === 'incoming') return ['mint', 'receive'];
      if (direction === 'outgoing') return ['melt', 'send'];
    }

    return [];
  }, [paymentType, direction]);

  const { history, isFetching } = usePaginatedHistory();

  const listKey = `${paymentType}-${direction}-${tab}-${selectedCurrency}-${selectedMonth}`;

  // Filter by currency and payment type/direction
  const filteredByTypeHistory = useMemo(() => {
    const allowedTypes = getCocoTransactionTypes();

    return history.filter((historyEntry) => {
      if (historyEntry.unit !== selectedCurrency) return false;
      if (allowedTypes.length > 0 && !allowedTypes.includes(historyEntry.type)) return false;
      return true;
    });
  }, [history, selectedCurrency, getCocoTransactionTypes]);

  const parsedAccount = { unit: selectedCurrency };

  // Header height for content padding (safe area + header bar + large title)
  const HEADER_HEIGHT = insets.top + 44 + 52; // safe area + small header + large title

  // Month selector as sticky content in the collapsing header
  const monthSelectorContent = useMemo(
    () => (
      <MonthSelector
        history={filteredByTypeHistory}
        selectedMonth={selectedMonth}
        onMonthChange={handleMonthChange}
      />
    ),
    [filteredByTypeHistory, selectedMonth, handleMonthChange]
  );

  // List header spacer
  const listHeader = useMemo(
    () => <View style={{ height: HEADER_HEIGHT + 48 }} />,
    [HEADER_HEIGHT]
  );

  return (
    <View style={{ flex: 1 }}>
      {/* Custom collapsing header */}
      <CollapsingHeader
        title="Transactions"
        headerLeft={headerLeft}
        headerRight={headerRight}
        stickyContent={monthSelectorContent}
        scrollY={scrollY}
      />

      {/* Transaction list */}
      <Transactions
        listKey={listKey}
        account={{ ...parsedAccount, unit: selectedCurrency }}
        showMore={false}
        history={history}
        isFetching={isFetching}
        filter={direction}
        type={paymentType}
        at="all"
        tab={tab}
        selectedMonth={selectedMonth}
        onTransactionPress={onTransactionPress}
        header={listHeader}
        onScroll={scrollHandler}
      />
    </View>
  );
}
