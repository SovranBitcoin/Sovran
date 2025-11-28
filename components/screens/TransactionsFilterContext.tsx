/**
 * @fileoverview Transactions Filter Context
 *
 * Provides shared filter state between the transactions layout header
 * and the TransactionsScreen component.
 */

import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { router } from 'expo-router';

export type PaymentType = 'all' | 'lightning' | 'ecash';
export type Direction = 'all' | 'incoming' | 'outgoing';
export type Status = 'All' | 'Confirmed' | 'Pending' | 'Expired';

interface TransactionsFilterState {
  currency: string;
  paymentType: PaymentType;
  direction: Direction;
  status: Status;
  selectedMonth: string | null;
}

interface TransactionsFilterContextValue extends TransactionsFilterState {
  setCurrency: (currency: string) => void;
  setPaymentType: (type: PaymentType) => void;
  setDirection: (dir: Direction) => void;
  setStatus: (status: Status) => void;
  setSelectedMonth: (month: string | null) => void;
  openFilterSheet: () => void;
  hasActiveFilters: boolean;
  activeFilterCount: number;
}

const TransactionsFilterContext = createContext<TransactionsFilterContextValue | null>(null);

interface TransactionsFilterProviderProps {
  children: ReactNode;
  initialCurrency?: string;
  initialPaymentType?: PaymentType;
  initialDirection?: Direction;
  initialStatus?: Status;
}

export function TransactionsFilterProvider({
  children,
  initialCurrency = 'sat',
  initialPaymentType = 'all',
  initialDirection = 'all',
  initialStatus = 'All',
}: TransactionsFilterProviderProps) {
  const [currency, setCurrency] = useState(initialCurrency);
  const [paymentType, setPaymentType] = useState<PaymentType>(initialPaymentType);
  const [direction, setDirection] = useState<Direction>(initialDirection);
  const [status, setStatus] = useState<Status>(initialStatus);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const openFilterSheet = useCallback(() => {
    router.push({
      pathname: '/(filter-flow)/filters',
      params: {
        currency,
        paymentType,
        direction,
        status,
      },
    });
  }, [currency, paymentType, direction, status]);

  const hasActiveFilters = useMemo(() => {
    return paymentType !== 'all' || direction !== 'all' || status !== 'All';
  }, [paymentType, direction, status]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (paymentType !== 'all') count++;
    if (direction !== 'all') count++;
    if (status !== 'All') count++;
    return count;
  }, [paymentType, direction, status]);

  const value = useMemo(
    () => ({
      currency,
      paymentType,
      direction,
      status,
      selectedMonth,
      setCurrency,
      setPaymentType,
      setDirection,
      setStatus,
      setSelectedMonth,
      openFilterSheet,
      hasActiveFilters,
      activeFilterCount,
    }),
    [
      currency,
      paymentType,
      direction,
      status,
      selectedMonth,
      openFilterSheet,
      hasActiveFilters,
      activeFilterCount,
    ]
  );

  return (
    <TransactionsFilterContext.Provider value={value}>
      {children}
    </TransactionsFilterContext.Provider>
  );
}

export function useTransactionsFilter() {
  const context = useContext(TransactionsFilterContext);
  if (!context) {
    throw new Error('useTransactionsFilter must be used within a TransactionsFilterProvider');
  }
  return context;
}

/**
 * Optional hook that returns null if outside provider (for conditional usage)
 */
export function useTransactionsFilterOptional() {
  return useContext(TransactionsFilterContext);
}

export default TransactionsFilterContext;

