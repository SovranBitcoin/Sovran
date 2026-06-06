/**
 * @fileoverview Transactions Filter Context
 *
 * Provides shared filter state between the transactions layout header
 * and the TransactionsScreen component.
 */

import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import type { TransactionDirection, TransactionPaymentType } from '@sovranbitcoin/colada';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';

type Status = 'All' | 'Confirmed' | 'Pending' | 'Expired';

interface TransactionsFilterState {
  currency: string;
  paymentType: TransactionPaymentType;
  direction: TransactionDirection;
  status: Status;
  mintUrl: string;
  selectedMonth: string | null;
}

interface TransactionsFilterContextValue extends TransactionsFilterState {
  setCurrency: (currency: string) => void;
  setPaymentType: (type: TransactionPaymentType) => void;
  setDirection: (dir: TransactionDirection) => void;
  setStatus: (status: Status) => void;
  setMintUrl: (mintUrl: string) => void;
  setSelectedMonth: (month: string | null) => void;
  openFilterSheet: () => void;
  hasActiveFilters: boolean;
  activeFilterCount: number;
}

const TransactionsFilterContext = createContext<TransactionsFilterContextValue | null>(null);

interface TransactionsFilterProviderProps {
  children: ReactNode;
  initialCurrency?: string;
  initialPaymentType?: TransactionPaymentType;
  initialDirection?: TransactionDirection;
  initialStatus?: Status;
  initialMintUrl?: string;
}

export function TransactionsFilterProvider({
  children,
  initialCurrency = 'sat',
  initialPaymentType = 'all',
  initialDirection = 'all',
  initialStatus = 'All',
  initialMintUrl = 'all',
}: TransactionsFilterProviderProps) {
  const [currency, setCurrency] = useState(initialCurrency);
  const [paymentType, setPaymentType] = useState<TransactionPaymentType>(initialPaymentType);
  const [direction, setDirection] = useState<TransactionDirection>(initialDirection);
  const [status, setStatus] = useState<Status>(initialStatus);
  const [mintUrl, setMintUrl] = useState(initialMintUrl);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const openFilterSheet = useCallback(() => {
    router.navigate({
      pathname: '/filters',
      params: {
        currency,
        paymentType,
        direction,
        status,
        mintUrl,
      },
    });
  }, [currency, paymentType, direction, status, mintUrl]);

  const hasActiveFilters = useMemo(() => {
    return paymentType !== 'all' || direction !== 'all' || status !== 'All' || mintUrl !== 'all';
  }, [paymentType, direction, status, mintUrl]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (paymentType !== 'all') count++;
    if (direction !== 'all') count++;
    if (status !== 'All') count++;
    if (mintUrl !== 'all') count++;
    return count;
  }, [paymentType, direction, status, mintUrl]);

  const value = useMemo(
    () => ({
      currency,
      paymentType,
      direction,
      status,
      mintUrl,
      selectedMonth,
      setCurrency,
      setPaymentType,
      setDirection,
      setStatus,
      setMintUrl,
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
      mintUrl,
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
