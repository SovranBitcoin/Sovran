import React, { useMemo, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import { useSelector } from 'react-redux';
import { useNavigation } from 'expo-router';

import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { store } from 'helper/redux/store';
import { useCashu } from 'helper/redux/cashu';
import { Transaction } from 'components/layout/Transaction';
import { Text } from 'components/common/Themed';
import { runWithAnimationFrame } from 'app/onboard/new';

interface Account {
  unit: string;
  type?: string;
}

interface TransactionsProps {
  account: Account;
  days?: number; // number of days to display when showMore=true
  filter?: 'all' | 'incoming' | 'outgoing';
  type?: string; // lightning | ecash | all
  at?: string; // filter for transactions with fromNIP05
  tab?: 'All' | 'Confirmed' | 'Pending';
  showMore?: boolean; // when true, limit days shown
}

const formatDate = (date: string): string => {
  const language = store.getState().settings?.settings.lang || 'en';
  return new Intl.DateTimeFormat(language, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(date));
};

export const Transactions: React.FC<TransactionsProps> = ({
  account,
  days = 1,
  filter = 'all',
  type = 'all',
  at = 'all',
  tab = 'All',
  showMore = true,
}) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const { transactions } = useCashu();
  const navigation = useNavigation();

  const filterFn = useMemo(
    () =>
      (tx: any) => {
        if (tx.unit !== account.unit) return false;
        if (filter === 'incoming' && tx.transactionType !== 'receive') return false;
        if (filter === 'outgoing' && tx.transactionType !== 'send') return false;
        if (type !== 'all' && tx.type !== type) return false;
        if (at === 'at' && !tx?.fromNIP05) return false;
        if (tab === 'Confirmed' && !tx.paid) return false;
        if (tab === 'Pending' && tx.paid) return false;
        return true;
      },
    [account.unit, filter, type, at, tab],
  );

  const [filteredTransactions, setFilteredTransactions] = useState<any[]>([]);

  useEffect(() => {
    runWithAnimationFrame(() => {
      const result = transactions
        .filter(filterFn)
        .sort(
          (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
        );
      setFilteredTransactions(result);
    })();
  }, [transactions, filterFn]);

  const splitByStatus = useMemo(() => {
    const pending: any[] = [];
    const confirmed: any[] = [];
    filteredTransactions.forEach((tx) => {
      if (tx.paid) confirmed.push(tx);
      else pending.push(tx);
    });
    return { pending, confirmed };
  }, [filteredTransactions]);

  const groupByDate = (txs: any[]) => {
    const groups: Record<string, any[]> = {};
    txs.forEach((tx) => {
      const key = formatDate(tx.date || new Date().toISOString());
      if (!groups[key]) groups[key] = [];
      groups[key].push(tx);
    });
    return groups;
  };

  const sliceGrouped = (txs: any[]) => {
    const grouped = groupByDate(txs);
    const ordered = Object.keys(grouped).sort(
      (a, b) => new Date(b).getTime() - new Date(a).getTime(),
    );
    const keys = showMore ? ordered.slice(0, days) : ordered;
    return keys.map((date) => ({ title: date, data: grouped[date] }));
  };

  const pendingSections = useMemo(
    () => sliceGrouped(splitByStatus.pending),
    [splitByStatus.pending, days, showMore],
  );

  const confirmedSections = useMemo(
    () => sliceGrouped(splitByStatus.confirmed),
    [splitByStatus.confirmed, days, showMore],
  );

  if (filteredTransactions.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text weight="heavy" style={{ color: greys(theme)[1000] }}>
          No Transactions
        </Text>
      </View>
    );
  }

  if (showMore) {
    const renderStatus = (label: string, sections: { title: string; data: any[] }[]) => {
      if (sections.length === 0) return null;
      return (
        <View>
          <View style={styles.statusHeader}>
            <Text weight="heavy" size={16} style={styles.transactionsLabel}>
              {label}
            </Text>
          </View>
          {sections.map((section) => (
            <View key={section.title}>
              <Text size={14} weight="heavy" style={styles.dateHeader}>
                {section.title}
              </Text>
              <View style={styles.transactionContainer}>
                {section.data.map((tx) => (
                  <Transaction
                    key={tx.request || tx.token || tx.txid || tx.id || Math.random().toString()}
                    tx={tx}
                  />
                ))}
              </View>
            </View>
          ))}
        </View>
      );
    };

    const containerStyles = [styles.container, !showMore && { marginTop: 0 }];
    return (
      <View style={containerStyles}>
        {renderStatus('Pending transactions', pendingSections)}
        {renderStatus('Confirmed transactions', confirmedSections)}
        <TouchableOpacity
          onPress={() =>
            navigation.navigate('transactions', {
              account,
            })
          }
          style={styles.viewMoreButton}>
          <Text style={styles.viewMoreButtonText}>View all ({filteredTransactions.length})</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const allSections = [...pendingSections, ...confirmedSections];

  return (
    <FlatList
      data={allSections}
      keyExtractor={(item) => item.title}
      renderItem={({ item }) => (
        <View>
          <Text size={14} weight="heavy" style={styles.dateHeader}>
            {item.title}
          </Text>
          <View style={styles.transactionContainer}>
            {item.data.map((tx) => (
              <Transaction
                key={tx.request || tx.token || tx.txid || tx.id || Math.random().toString()}
                tx={tx}
              />
            ))}
          </View>
        </View>
      )}
      contentContainerStyle={[styles.container, { marginTop: 0 }]}
    />
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      width: '100%',
      marginTop: -48,
      paddingBottom: 96,
    },
    statusHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingBottom: 0,
      backgroundColor: 'transparent',
    },
    dateHeader: {
      color: greys(theme)[1000],
      fontFamily: 'OverpassHeavy',
      marginVertical: 4,
    },
    transactionsLabel: {
      color: greys(theme)[1000],
      fontFamily: 'OverpassHeavy',
      margin: 0,
      fontSize: 16,
    },
    emptyContainer: {
      alignItems: 'center',
      marginVertical: 16,
    },
    transactionContainer: {
      backgroundColor: greys(theme)[1800],
      borderColor: greys(theme)[1500],
      borderWidth: 0.2,
      borderRadius: 8,
      marginVertical: 8,
    },
    viewMoreButton: {
      alignItems: 'center',
      padding: 12,
      backgroundColor: greys(theme)[1800],
      borderRadius: 10000,
      borderColor: greys(theme)[1500],
      borderWidth: 0.2,
      marginHorizontal: 16,
      marginTop: 8,
    },
    viewMoreButtonText: {
      fontFamily: 'OverpassBold',
      fontSize: 14,
      color: greys(theme)[0],
    },
  });

