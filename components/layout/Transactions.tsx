import React from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { TouchableOpacity } from 'react-native';
import { useNavigation } from 'expo-router';
import { useSelector } from 'react-redux';

import { greys } from 'helper/colors';
import { Transaction } from 'components/layout/Transaction';
import { useCashu } from 'helper/redux/cashu';
import { Text } from 'components/common/Themed';
import { store } from 'helper/redux/store';
import Icon from 'assets/icons';
import { memoizedGetTheme } from 'helper/redux/settings';
import { getRawExpiry } from '../cashu';

// Helper function to format the date as needed
const formatDate = (date: string): string => {
  const language = store.getState().settings?.settings.lang || 'en';
  return new Intl.DateTimeFormat(language, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(date));
};

interface Transaction {
  date: string;
  type: string;
  paid: boolean;
  transactionType?: string;
  isCancel?: boolean;
  npubcash?: boolean;
  request?: string;
  token?: string;
  isSweep?: boolean;
  unit?: string;
  amount?: number;
  lnurl?: boolean;
}

interface TransactionsProps {
  account: {
    type: string;
    unit: string;
  };
  days: number;
  limit?: number;
  showMore: boolean;
  filter: 'all' | 'incoming' | 'outgoing';
  type?: string;
  at?: string;
  tab?: string;
}

export const Transactions: React.FC<TransactionsProps> = ({
  account,
  showMore = true,
  tab = 'All',
  filter = 'all',
  type = 'all',
  at = 'all',
  days = 30,
  limit,
}) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const { transactions: cashuTransactions } = useCashu();
  const navigation = useNavigation();

  // Filter transactions based on account type and filter prop
  const filterTransactions = (transactions: Transaction[]) => {
    // First filter by account type/unit
    let filtered = transactions.filter((tx) => tx.unit === account.unit);

    // Then filter by transaction type
    filtered = filtered.filter((tx) => {
      if (filter === 'all') return true;
      if (filter === 'incoming') return tx.transactionType === 'receive';
      if (filter === 'outgoing') return tx.transactionType === 'send';
      return true;
    });

    filtered = filtered.filter((tx) => {
      if (type === 'all') return true;
      return tx.type === type;
    });

    filtered = filtered.filter((tx) => {
      if (at === 'all') return true;
      return at === 'at' && tx?.fromNIP05;
    });

    return filtered;
  };

  // Split transactions into pending and confirmed
  const splitTransactionsByStatus = (transactions: Transaction[]) => {
    const pending: Transaction[] = [];
    const confirmed: Transaction[] = [];

    transactions.forEach((tx) => {
      if (tx.paid === true) {
        confirmed.push(tx);
      } else {
        // Check if the pending transaction is expired
        const isExpired = tx.request && new Date() >= getRawExpiry({ pr: tx.request });
        if (!isExpired) {
          pending.push(tx);
        }
      }
    });

    return { pending, confirmed };
  };

  // Apply filters to transactions
  const filteredTransactions = filterTransactions(cashuTransactions || []);
  const { pending: filteredPendingTransactions, confirmed: filteredConfirmedTransactions } =
    splitTransactionsByStatus(filteredTransactions);

  // Limit the number of transactions per status shown on the index page
  const MAX_DISPLAYED_TRANSACTIONS_PER_STATUS = 10;
  const sortByDateDesc = (a: Transaction, b: Transaction) =>
    new Date(b.date).getTime() - new Date(a.date).getTime();

  const limitedPendingTransactions = [...filteredPendingTransactions]
    .sort(sortByDateDesc)
    .slice(0, MAX_DISPLAYED_TRANSACTIONS_PER_STATUS);

  const limitedConfirmedTransactions = [...filteredConfirmedTransactions]
    .sort(sortByDateDesc)
    .slice(0, MAX_DISPLAYED_TRANSACTIONS_PER_STATUS);

  const limitedTransactions = [...limitedPendingTransactions, ...limitedConfirmedTransactions];

  // Group transactions by date for better display
  const groupTransactionsByStatusAndDate = (txs: Transaction[]) => {
    const grouped = {
      confirmed: {} as Record<string, Transaction[]>,
      pending: {} as Record<string, Transaction[]>,
    };

    // Sort transactions by date (newest first) before grouping
    let sortedTxs = [...txs].sort((a, b) => {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    // filter transactions that are expired
    const isExpired = (tx: Transaction) =>
      !tx.paid && tx.request ? new Date() >= getRawExpiry({ pr: tx.request }) : false;

    // Filter out expired transactions
    sortedTxs = sortedTxs.filter((tx) => !isExpired(tx));

    sortedTxs.forEach((tx) => {
      const date = formatDate(tx.date);
      const status = tx.paid === true ? 'confirmed' : 'pending';

      if (!grouped[status][date]) {
        grouped[status][date] = [];
      }

      grouped[status][date].push(tx);
    });

    return grouped;
  };

  // Group the limited transactions by status and date for display
  const groupedTransactions = groupTransactionsByStatusAndDate(limitedTransactions);

  // Get appropriate label based on filter
  const getLabel = () => {
    if (filteredConfirmedTransactions.length === 0 && filteredPendingTransactions.length === 0) {
      return 'No Transactions';
    }
    switch (filter) {
      case 'incoming':
        return 'Incoming Transactions';
      case 'outgoing':
        return 'Outgoing Transactions';
      default:
        return 'All Transactions';
    }
  };

  const label = getLabel();

  // Determine which transactions to show based on the selected tab
  const getTransactionsToShow = () => {
    if (tab === 'All') {
      return ['pending', 'confirmed'];
    } else if (tab === 'Confirmed') {
      return ['confirmed'];
    } else if (tab === 'Pending') {
      return ['pending'];
    }
    return ['pending', 'confirmed']; // Default to all
  };

  const transactionsToShow = getTransactionsToShow();

  // Determine if there are any transactions to display
  const hasTransactionsToDisplay = !transactionsToShow.every(
    (status) => Object.keys(groupedTransactions[status] || {}).length === 0
  );

  // Render no transactions message
  const renderNoTransactionsMessage = () => (
    <View style={[styles.header, styles.headerNoTransactions]}>
      <Icon name="fluent:clock-12-filled" color={greys(theme)[1000]} />
      <Text
        weight="heavy"
        size={16}
        style={[styles.transactionsLabel, { color: greys(theme)[700] }]}>
        {!showMore ? `No ${tab !== 'All' ? tab : ''} Transactions` : label}
      </Text>
      <Text size={14} style={[styles.transactionsLabel, styles.noTransactionsText]}>
        {label.startsWith('No') && label !== 'No Transactions'
          ? 'Try changing your filter settings'
          : !showMore && !hasTransactionsToDisplay
            ? `No ${tab.toLowerCase()} transactions to display`
            : 'Your transactions will show up here'}
      </Text>
    </View>
  );

  // Render transactions for a specific status
  const renderTransactionsForStatus = (status: string) => {
    const transactionsForStatus = groupedTransactions[status] || {};
    const hasTransactions = Object.keys(transactionsForStatus).length > 0;

    if (!hasTransactions) {
      // Only return null if we're in showMore mode - otherwise show an empty state message for each tab
      if (showMore) {
        return null;
      }
      return (
        <View key={`empty-${status}`} style={[styles.header, styles.headerNoTransactions]}>
          <Text
            weight="heavy"
            size={16}
            style={[
              styles.transactionsLabel,
              {
                color: greys(theme)[700],
                marginTop: 10,
              },
            ]}>
            No {status === 'confirmed' ? 'Confirmed' : 'Pending'} Transactions
          </Text>
        </View>
      );
    }

    return (
      <View key={status}>
        {showMore && (
          <View style={styles.pendingHeader}>
            <Text weight="heavy" size={showMore ? 16 : 20} style={styles.transactionsLabel}>
              {status === 'confirmed' ? 'Confirmed transactions' : 'Pending transactions'}
            </Text>
          </View>
        )}

        {Object.entries(transactionsForStatus)
          .slice(0, days ? days : undefined)
          .map(([date, transactions]) => (
            <View key={date}>
              <Text size={showMore ? 14 : 16} style={styles.dateHeader}>
                {date}
              </Text>

              <View style={styles.transactionContainer}>
                {Array.isArray(transactions) &&
                  (limit ? transactions.slice(0, limit) : transactions).map((tx: Transaction) => (
                    <View
                      key={tx.request || `${tx.token || ''}${tx.transactionType || ''}`}
                      style={{ flexDirection: 'column' }}>
                      <Transaction tx={tx} transactions={transactions} account={account} />
                    </View>
                  ))}
              </View>
            </View>
          ))}
      </View>
    );
  };

  // Render view more button
  const renderViewMoreButton = () => (
    <TouchableOpacity
      onPress={() => {
        navigation.navigate('transactions', {
          account: account,
        });
      }}
      style={styles.viewMoreButton}>
      <Text style={styles.viewMoreButtonText}>
        View all ({filteredConfirmedTransactions.length + filteredPendingTransactions.length})
      </Text>
    </TouchableOpacity>
  );

  return (
    <Animated.View style={styles.container}>
      {!hasTransactionsToDisplay
        ? renderNoTransactionsMessage()
        : transactionsToShow.map(renderTransactionsForStatus)}

      {showMore && renderViewMoreButton()}
    </Animated.View>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      opacity: 1,
      marginTop: -48,
      marginBottom: 96,
    },
    pendingHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingBottom: 0,
      backgroundColor: 'transparent',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingBottom: 0,
      backgroundColor: 'transparent',
    },
    headerNoTransactions: {
      flexDirection: 'column',
      alignItems: 'center',
      backgroundColor: 'transparent',
    },
    noTransactionsText: {
      color: greys(theme)[1000],
      alignSelf: 'center',
    },
    dateHeader: {
      fontFamily: 'OverpassHeavy',
      color: greys(theme)[1000],
      textAlign: 'left',
      marginVertical: 4,
      backgroundColor: 'transparent',
    },
    transactionsLabel: {
      color: greys(theme)[700],
      fontFamily: 'OverpassBold',
      margin: 0,
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
