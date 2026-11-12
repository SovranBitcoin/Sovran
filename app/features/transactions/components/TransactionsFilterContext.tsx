/**
 * @fileoverview Transactions Filter Context
 *
 * The transaction filters as one value: its fields, defaults and active count,
 * and its two route encodings. Transactions opens the filter sheet with every
 * filter under its own name (`currency`, `status`, ...); the sheet and the links
 * into Transactions (and deep links) use `filter`-prefixed params
 * (`filterCurrency`, ...). The provider shares the value between the
 * transactions header and the list.
 */

import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { z } from 'zod';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { cashuLog } from '@/shared/lib/logger';

/** Each filter's accepted values; the same limits in both route encodings. */
const FILTER_FIELDS = {
  currency: z.string().max(16),
  paymentType: z.enum(['all', 'lightning', 'ecash', 'onchain']),
  direction: z.enum(['all', 'incoming', 'outgoing']),
  status: z.enum(['All', 'Confirmed', 'Pending', 'Expired']),
  mintUrl: z.string().max(2048),
  source: z.enum(['all', 'qr', 'nfc', 'ble', 'paste', 'deeplink']),
  lock: z.enum(['all', 'locked', 'unlocked']),
  counterparty: z.enum(['all', 'with']),
  /** 'zaps' = melts carrying a zap annotation (paid for a nostr post). */
  zap: z.enum(['all', 'zaps']),
};

export type TransactionFilters = {
  [K in keyof typeof FILTER_FIELDS]: z.infer<(typeof FILTER_FIELDS)[K]>;
};
type FilterKey = keyof TransactionFilters;

export const DEFAULT_TRANSACTION_FILTERS: TransactionFilters = {
  currency: 'sat',
  paymentType: 'all',
  direction: 'all',
  status: 'All',
  mintUrl: 'all',
  source: 'all',
  lock: 'all',
  counterparty: 'all',
  zap: 'all',
};

const FILTER_KEYS = Object.keys(DEFAULT_TRANSACTION_FILTERS) as FilterKey[];

/** How many filters differ from their default; any currency but sats counts. */
export function countActiveFilters(filters: TransactionFilters): number {
  return FILTER_KEYS.filter((key) =>
    key === 'currency'
      ? filters.currency.toLowerCase() !== 'sat'
      : filters[key] !== DEFAULT_TRANSACTION_FILTERS[key]
  ).length;
}

/** The filter sheet's params: every filter under its own name. */
export const FilterSheetParamsSchema = z.object(FILTER_FIELDS).partial();

/** The sheet's starting draft: a missing or empty param is the default. */
export function filtersFromSheetParams(
  params: z.infer<typeof FilterSheetParamsSchema> | null
): TransactionFilters {
  const filters = { ...DEFAULT_TRANSACTION_FILTERS };
  for (const key of FILTER_KEYS) if (params?.[key]) Object.assign(filters, { [key]: params[key] });
  return filters;
}

const routeKey = <K extends FilterKey>(key: K) =>
  `filter${key[0].toUpperCase()}${key.slice(1)}` as `filter${Capitalize<K>}`;

type TransactionsRouteParams = {
  [K in FilterKey as `filter${Capitalize<K>}`]?: TransactionFilters[K];
};

/** Transactions' params: `filter` and the filter's name, each optional. */
export const TransactionsRouteParamsSchema = z.object(
  Object.fromEntries(FILTER_KEYS.map((key) => [routeKey(key), FILTER_FIELDS[key].optional()]))
) as unknown as z.ZodType<TransactionsRouteParams>;

/** Params that open Transactions with these filters; filters left out stay as they are. */
export function transactionsRouteParams(
  filters: Partial<TransactionFilters>
): TransactionsRouteParams {
  return Object.fromEntries(
    Object.entries(filters).map(([key, value]) => [routeKey(key as FilterKey), value])
  );
}

/** The filters Transactions' params name; an empty param names none. */
export function filtersFromTransactionsParams(
  params: TransactionsRouteParams
): Partial<TransactionFilters> {
  const filters: Partial<TransactionFilters> = {};
  for (const key of FILTER_KEYS) {
    const value = params[routeKey(key)];
    if (value) Object.assign(filters, { [key]: value });
  }
  return filters;
}

interface TransactionsFilterContextValue {
  filters: TransactionFilters;
  /** Changes the named filters and keeps the rest. */
  updateFilters: (changes: Partial<TransactionFilters>) => void;
  selectedMonth: string | null;
  setSelectedMonth: (month: string | null) => void;
  openFilterSheet: () => void;
  activeFilterCount: number;
}

const TransactionsFilterContext = createContext<TransactionsFilterContextValue | null>(null);

interface TransactionsFilterProviderProps {
  children: ReactNode;
}

export function TransactionsFilterProvider({ children }: TransactionsFilterProviderProps) {
  const [filters, setFilters] = useState(DEFAULT_TRANSACTION_FILTERS);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const updateFilters = useCallback((changes: Partial<TransactionFilters>) => {
    setFilters((current) =>
      FILTER_KEYS.every((key) => changes[key] === undefined || changes[key] === current[key])
        ? current
        : { ...current, ...changes }
    );
  }, []);

  const openFilterSheet = useCallback(() => {
    cashuLog.info('transactions.filters.open', {
      currency: filters.currency,
      paymentType: filters.paymentType,
      direction: filters.direction,
      status: filters.status,
      hasMintFilter: filters.mintUrl !== 'all',
      hasSelectedMonth: !!selectedMonth,
    });
    router.navigate({ pathname: '/filters', params: filters });
  }, [filters, selectedMonth]);

  const value = useMemo(
    () => ({
      filters,
      updateFilters,
      selectedMonth,
      setSelectedMonth,
      openFilterSheet,
      activeFilterCount: countActiveFilters(filters),
    }),
    [filters, updateFilters, selectedMonth, openFilterSheet]
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
