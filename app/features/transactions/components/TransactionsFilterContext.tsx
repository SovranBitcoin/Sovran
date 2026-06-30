/**
 * @fileoverview Transactions Filter Context
 *
 * Provides shared filter state between the transactions layout header
 * and the TransactionsScreen component.
 */

import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import type {
  ScanMethod,
  TransactionDirection,
  TransactionPaymentType,
} from 'wallet';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { cashuLog } from '@/shared/lib/logger';

type Status = 'All' | 'Confirmed' | 'Pending' | 'Expired';

/** Annotation-driven filters added on top of currency/type/direction/status/mint. */
export type TransactionSourceFilter = 'all' | ScanMethod;
export type TransactionLockFilter = 'all' | 'locked' | 'unlocked';
export type TransactionCounterpartyFilter = 'all' | 'with';

interface TransactionsFilterState {
  currency: string;
  paymentType: TransactionPaymentType;
  direction: TransactionDirection;
  status: Status;
  mintUrl: string;
  source: TransactionSourceFilter;
  lock: TransactionLockFilter;
  counterparty: TransactionCounterpartyFilter;
  selectedMonth: string | null;
}

interface TransactionsFilterContextValue extends TransactionsFilterState {
  setCurrency: (currency: string) => void;
  setPaymentType: (type: TransactionPaymentType) => void;
  setDirection: (dir: TransactionDirection) => void;
  setStatus: (status: Status) => void;
  setMintUrl: (mintUrl: string) => void;
  setSource: (source: TransactionSourceFilter) => void;
  setLock: (lock: TransactionLockFilter) => void;
  setCounterparty: (counterparty: TransactionCounterpartyFilter) => void;
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
  const [source, setSource] = useState<TransactionSourceFilter>('all');
  const [lock, setLock] = useState<TransactionLockFilter>('all');
  const [counterparty, setCounterparty] = useState<TransactionCounterpartyFilter>('all');
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const openFilterSheet = useCallback(() => {
    cashuLog.info('transactions.filters.open', {
      currency,
      paymentType,
      direction,
      status,
      hasMintFilter: mintUrl !== 'all',
      hasSelectedMonth: !!selectedMonth,
    });
    router.navigate({
      pathname: '/filters',
      params: {
        currency,
        paymentType,
        direction,
        status,
        mintUrl,
        source,
        lock,
        counterparty,
      },
    });
  }, [
    currency,
    paymentType,
    direction,
    status,
    mintUrl,
    source,
    lock,
    counterparty,
    selectedMonth,
  ]);

  const hasActiveFilters = useMemo(() => {
    return (
      paymentType !== 'all' ||
      direction !== 'all' ||
      status !== 'All' ||
      mintUrl !== 'all' ||
      source !== 'all' ||
      lock !== 'all' ||
      counterparty !== 'all'
    );
  }, [paymentType, direction, status, mintUrl, source, lock, counterparty]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (paymentType !== 'all') count++;
    if (direction !== 'all') count++;
    if (status !== 'All') count++;
    if (mintUrl !== 'all') count++;
    if (source !== 'all') count++;
    if (lock !== 'all') count++;
    if (counterparty !== 'all') count++;
    return count;
  }, [paymentType, direction, status, mintUrl, source, lock, counterparty]);

  const value = useMemo(
    () => ({
      currency,
      paymentType,
      direction,
      status,
      mintUrl,
      source,
      lock,
      counterparty,
      selectedMonth,
      setCurrency,
      setPaymentType,
      setDirection,
      setStatus,
      setMintUrl,
      setSource,
      setLock,
      setCounterparty,
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
      source,
      lock,
      counterparty,
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
