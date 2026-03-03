/**
 * @fileoverview Shared Transactions screen component
 *
 * This module provides the core UI and logic for the transactions list.
 * It is used by both standalone and flow-based route wrappers.
 *
 * Features:
 * - Native Stack header handles title and buttons
 * - Sticky month selector with blur/gradient below header (via ModalLayoutWrapper)
 * - Virtualized transaction list
 * - Filter support via external props (from filter flow)
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View } from '@/shared/ui/primitives/View/View';
import { Transactions } from '@/features/transactions/components/Transactions';
import { MonthSelector } from '@/features/transactions/components/MonthSelector';
import { HistoryEntry } from 'coco-cashu-core';
import { useHistoryWithMelts } from '@/features/transactions/hooks/useHistoryWithMelts';
import { ModalLayoutWrapper } from '@/shared/ui/composed/ModalLayoutWrapper';

type StatusTab = 'All' | 'Confirmed' | 'Pending' | 'Expired';
type PaymentType = 'all' | 'lightning' | 'ecash';
type Direction = 'all' | 'incoming' | 'outgoing';

// Height constant for month selector (sticky content)
const MONTH_SELECTOR_HEIGHT = 48;

interface TransactionsScreenProps {
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
  /** External filter: mint URL (from filter flow) */
  filterMintUrl?: string;
  /** External filter: selected month key (format: "YYYY-MM") */
  filterMonth?: string | null;
  /** Callback when month selection changes */
  onMonthChange?: (month: string | null) => void;
}

export function TransactionsScreen({
  initialAccount,
  initialTab = 'All',
  onTransactionPress,
  filterCurrency,
  filterPaymentType = 'all',
  filterDirection = 'all',
  filterMintUrl = 'all',
  filterMonth,
  onMonthChange,
}: TransactionsScreenProps) {
  // Use external filter props if provided, otherwise use internal state
  const selectedCurrency = filterCurrency || initialAccount?.unit || 'sat';
  const paymentType = filterPaymentType;
  const direction = filterDirection;
  const tab = initialTab; // Status tab now comes from filter flow

  // Internal state for month selection if no external handler provided
  const [internalMonth, setInternalMonth] = useState<string | null>(null);
  const selectedMonth = filterMonth !== undefined ? filterMonth : internalMonth;
  const handleMonthChange = onMonthChange || setInternalMonth;

  // Track total header height from ModalLayoutWrapper
  const [totalHeaderHeight, setTotalHeaderHeight] = useState(0);

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

  const { history, isFetching } = useHistoryWithMelts();

  const listKey = `${paymentType}-${direction}-${tab}-${selectedCurrency}-${filterMintUrl}-${selectedMonth}`;

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

  // Month selector sticky content
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

  // List header spacer to push content below sticky header
  const listHeader = useMemo(
    () => <View style={{ height: totalHeaderHeight }} />,
    [totalHeaderHeight]
  );

  return (
    <ModalLayoutWrapper
      headerGradient
      stickyContent={monthSelectorContent}
      stickyContentHeight={MONTH_SELECTOR_HEIGHT}
      useCustomScrollView
      onHeaderHeightChange={setTotalHeaderHeight}>
      {/* Transaction list with proper header spacer */}
      <Transactions
        listKey={listKey}
        account={{ ...parsedAccount, unit: selectedCurrency }}
        showMore={false}
        history={history}
        isFetching={isFetching}
        filter={direction}
        type={paymentType}
        mintUrlFilter={filterMintUrl}
        at="all"
        tab={tab}
        selectedMonth={selectedMonth}
        onTransactionPress={onTransactionPress}
        header={listHeader}
        disableContentInsetAdjustment
      />
    </ModalLayoutWrapper>
  );
}
