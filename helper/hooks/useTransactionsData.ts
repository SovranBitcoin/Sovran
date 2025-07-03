import { useMemo } from 'react';
import { TransactionData } from 'helper/redux/cashu';
import { store } from 'helper/redux/store';

interface Account {
  unit: string;
  type?: string;
}

interface Options {
  transactions: TransactionData[];
  account: Account;
  days?: number;
  filter?: 'all' | 'incoming' | 'outgoing';
  type?: string;
  at?: string;
  tab?: 'All' | 'Confirmed' | 'Pending';
  showMore?: boolean;
}

const formatDate = (date: string): string => {
  const language = store.getState().settings?.settings.lang || 'en';
  return new Intl.DateTimeFormat(language, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(date));
};

export function useTransactionsData({
  transactions,
  account,
  days = 1,
  filter = 'all',
  type = 'all',
  at = 'all',
  tab = 'All',
  showMore = true,
}: Options) {
  const filterFn = useMemo(
    () => (tx: TransactionData) => {
      if (tx.unit !== account.unit) return false;
      if (filter === 'incoming' && tx.transactionType !== 'receive') return false;
      if (filter === 'outgoing' && tx.transactionType !== 'send') return false;
      if (type !== 'all' && tx.type !== type) return false;
      if (at === 'at' && !tx?.fromNIP05) return false;
      if (tab === 'Confirmed' && !tx.paid) return false;
      if (tab === 'Pending' && tx.paid) return false;
      return true;
    },
    [account.unit, filter, type, at, tab]
  );

  const filteredTransactions = useMemo(
    () =>
      transactions
        .filter(filterFn)
        .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()),
    [transactions, filterFn]
  );

  const splitByStatus = useMemo(() => {
    const pending: TransactionData[] = [];
    const confirmed: TransactionData[] = [];
    filteredTransactions.forEach((tx) => {
      if (tx.paid) confirmed.push(tx);
      else pending.push(tx);
    });
    return { pending, confirmed };
  }, [filteredTransactions]);

  const groupByDate = (txs: TransactionData[]) => {
    const groups: Record<string, TransactionData[]> = {};
    txs.forEach((tx) => {
      const key = formatDate(tx.date || new Date().toISOString());
      if (!groups[key]) groups[key] = [];
      groups[key].push(tx);
    });
    return groups;
  };

  const memoizedGroupByDate = useMemo(() => groupByDate, []);

  const sliceGrouped = (txs: TransactionData[]) => {
    const grouped = memoizedGroupByDate(txs);
    const ordered = Object.keys(grouped).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    const keys = showMore ? ordered.slice(0, days) : ordered;
    return keys.map((date) => ({ title: date, data: grouped[date], index: date }));
  };

  const pendingSections = useMemo(() => sliceGrouped(splitByStatus.pending), [splitByStatus.pending, days, showMore]);
  const confirmedSections = useMemo(() => sliceGrouped(splitByStatus.confirmed), [splitByStatus.confirmed, days, showMore]);
  const allSections = useMemo(() => [...pendingSections, ...confirmedSections], [pendingSections, confirmedSections]);

  const pendingDisplayedCount = useMemo(
    () => pendingSections.reduce((total, section) => total + section.data.length, 0),
    [pendingSections]
  );

  const morePendingCount = useMemo(
    () => splitByStatus.pending.length - pendingDisplayedCount,
    [splitByStatus.pending.length, pendingDisplayedCount]
  );

  const counts = useMemo(
    () => ({
      all: filteredTransactions.length,
      confirmed: splitByStatus.confirmed.length,
      pending: splitByStatus.pending.length,
    }),
    [filteredTransactions.length, splitByStatus.confirmed.length, splitByStatus.pending.length]
  );

  return {
    filteredTransactions,
    pendingSections,
    confirmedSections,
    allSections,
    morePendingCount,
    counts,
  };
}
