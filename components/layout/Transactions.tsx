import React, { useMemo } from 'react';
import { View, StyleSheet, SectionList, TouchableOpacity } from 'react-native';
import { useSelector } from 'react-redux';
import { useNavigation } from 'expo-router';

import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { store } from 'helper/redux/store';
import { useCashu } from 'helper/redux/cashu';
import { Transaction } from 'components/layout/Transaction';
import { Text } from 'components/common/Themed';

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

  const filteredTransactions = useMemo(() => {
    return (
      transactions
        // filter by account unit
        .filter((tx) => tx.unit === account.unit)
        // incoming or outgoing
        .filter((tx) => {
          if (filter === 'incoming') return tx.transactionType === 'receive';
          if (filter === 'outgoing') return tx.transactionType === 'send';
          return true;
        })
        // lightning vs ecash
        .filter((tx) => (type === 'all' ? true : tx.type === type))
        // transactions via NIP05
        .filter((tx) => (at === 'at' ? tx?.fromNIP05 : true))
        // pending/confirmed tabs
        .filter((tx) => {
          if (tab === 'Confirmed') return tx.paid === true;
          if (tab === 'Pending') return !tx.paid;
          return true;
        })
        .sort(
          (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
        )
    );
  }, [transactions, account.unit, filter, type, at, tab]);

  const grouped = useMemo(() => {
    const groups: Record<string, typeof filteredTransactions> = {};
    filteredTransactions.forEach((tx) => {
      const key = formatDate(tx.date || new Date().toISOString());
      if (!groups[key]) groups[key] = [];
      groups[key].push(tx);
    });
    return groups;
  }, [filteredTransactions]);

  const sections = useMemo(() => {
    const orderedDates = Object.keys(grouped).sort(
      (a, b) => new Date(b).getTime() - new Date(a).getTime(),
    );
    const datesToDisplay = showMore ? orderedDates.slice(0, days) : orderedDates;
    return datesToDisplay.map((date) => ({ title: date, data: [grouped[date]] }));
  }, [grouped, days, showMore]);

  if (sections.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text weight="heavy" style={{ color: greys(theme)[1000] }}>
          No Transactions
        </Text>
      </View>
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(_, index) => index.toString()}
      renderItem={({ item }) => (
        <View style={styles.transactionContainer}>
          {item.map((tx) => (
            <Transaction
              key={tx.request || tx.token || tx.txid || tx.id || Math.random().toString()}
              tx={tx}
            />
          ))}
        </View>
      )}
      renderSectionHeader={({ section: { title } }) => (
        <Text size={14} weight="heavy" style={styles.dateHeader}>
          {title}
        </Text>
      )}
      contentContainerStyle={styles.container}
      initialNumToRender={10}
      maxToRenderPerBatch={5}
      windowSize={10}
      ListFooterComponent={
        showMore
          ? () => (
              <TouchableOpacity
                onPress={() =>
                  navigation.navigate('transactions', {
                    account,
                  })
                }
                style={styles.viewMoreButton}>
                <Text style={styles.viewMoreButtonText}>
                  View all ({filteredTransactions.length})
                </Text>
              </TouchableOpacity>
            )
          : null
      }
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
    dateHeader: {
      color: greys(theme)[1000],
      fontFamily: 'OverpassHeavy',
      marginVertical: 4,
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

