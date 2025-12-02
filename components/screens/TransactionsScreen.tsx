/**
 * @fileoverview Shared Transactions screen component
 *
 * This module provides the core UI and logic for the transactions list.
 * It is used by both standalone and flow-based route wrappers.
 *
 * Features:
 * - Native Stack header handles title and buttons
 * - Sticky month selector with blur/gradient below header
 * - Virtualized transaction list
 * - Filter support via external props (from filter flow)
 */

import React, { useState, useCallback, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { View } from 'components/ui/View';
import { Transactions } from 'components/blocks/Transactions';
import { MonthSelector } from 'components/blocks/MonthSelector';
import { HistoryEntry } from 'coco-cashu-core';
import { usePaginatedHistory } from 'coco-cashu-react';
import { useHeaderHeight } from '@react-navigation/elements';
import { useTheme } from 'providers/ThemeProvider';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';

type StatusTab = 'All' | 'Confirmed' | 'Pending' | 'Expired';
type PaymentType = 'all' | 'lightning' | 'ecash';
type Direction = 'all' | 'incoming' | 'outgoing';

// Height constant for month selector
const MONTH_SELECTOR_HEIGHT = 48;

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
}: TransactionsScreenProps) {
  const headerHeight = useHeaderHeight();
  const { getPrimaryColor } = useTheme();

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

  // Total header height for content padding (native header + month selector)
  const totalHeaderHeight = headerHeight + MONTH_SELECTOR_HEIGHT;

  // Month selector content
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
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
      {/* Header gradient with blur effect - positioned at top */}
      <View
        style={[styles.headerGradientContainer, { height: headerHeight * 2 }]}
        pointerEvents="none">
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <LinearGradient
              colors={['black', 'black', 'transparent']}
              locations={[0, 0.5, 1]}
              style={StyleSheet.absoluteFill}
            />
          }>
          <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
          <LinearGradient
            colors={[getPrimaryColor('950'), 'transparent']}
            locations={[0.5, 1]}
            style={StyleSheet.absoluteFill}
          />
        </MaskedView>
      </View>

      {/* Sticky month selector below native header */}
      <View style={[styles.stickyContainer, { top: headerHeight }]}>{monthSelectorContent}</View>

      {/* Transaction list with proper header spacer */}
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
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerGradientContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
  },
  stickyContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 99,
  },
});
