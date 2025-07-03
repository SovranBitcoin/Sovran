import React, { useMemo } from 'react';
import { SectionList, TouchableOpacity, Dimensions } from 'react-native';
import { useSelector } from 'react-redux';
import { useNavigation } from 'expo-router';

import { memoizedGetTheme } from 'helper/redux/settings';
import { store } from 'helper/redux/store';
import { useCashu } from 'helper/redux/cashu';
import { Transaction } from 'components/layout/Transaction';
import { Text } from 'components/common/Text';
import Icon from 'assets/icons';

import { View } from 'components/common/View';

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

export const Transactions = React.memo(
  ({
    account,
    days = 1,
    filter = 'all',
    type = 'all',
    at = 'all',
    tab = 'All',
    showMore = true,
  }: TransactionsProps) => {
    const theme = useSelector(memoizedGetTheme);
    const navigation = useNavigation();
    const { transactions } = useCashu();

    const filterFn = useMemo(
      () => (tx: any) => {
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

    const memoizedGroupByDate = useMemo(() => groupByDate, []);

    const sliceGrouped = (txs: any[]) => {
      const grouped = memoizedGroupByDate(txs);
      const ordered = Object.keys(grouped).sort(
        (a, b) => new Date(b).getTime() - new Date(a).getTime()
      );
      const keys = showMore ? ordered.slice(0, days) : ordered;
      return keys.map((date) => ({ title: date, data: grouped[date], index: date }));
    };

    const pendingSections = useMemo(
      () => sliceGrouped(splitByStatus.pending),
      [splitByStatus.pending, days, showMore]
    );

    const confirmedSections = useMemo(
      () => sliceGrouped(splitByStatus.confirmed),
      [splitByStatus.confirmed, days, showMore]
    );

    const allSections = useMemo(
      () => [...pendingSections, ...confirmedSections],
      [pendingSections, confirmedSections]
    );

    const pendingDisplayedCount = useMemo(
      () =>
        pendingSections.reduce(
          (total, section) => total + section.data.length,
          0
        ),
      [pendingSections]
    );

    const morePendingCount = useMemo(
      () => splitByStatus.pending.length - pendingDisplayedCount,
      [splitByStatus.pending.length, pendingDisplayedCount]
    );

    if (filteredTransactions.length === 0) {
      return (
        <View className="flex items-center">
          <Icon name="fluent:clock-12-filled" color={theme.greys[500]} />
          <Text heavy size={16} style={{ color: theme.greys[500] }}>
            No Transactions
          </Text>
          <Text color={theme.greys[500]} heavy size={16}>
            Your transactions will show up here
          </Text>
        </View>
      );
    }

    if (showMore) {
      const renderStatus = (label: string, sections: { title: string; data: any[] }[]) => {
        if (sections.length === 0) return null;
        return (
          <View>
            <View className="flex-row items-start">
              <Text heavy size={16} color={theme.greys[100]} className="mt-2">
                {label}
              </Text>
            </View>
            {sections.map((section) => (
              <View key={section.title}>
                <Text size={14} heavy color={theme.greys[100]} className="mb-1">
                  {section.title}
                </Text>
                <View
                  style={{
                    backgroundColor: theme.greys[900],
                  }}
                  className="rounded-lg"
                  blur>
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

      return (
        <View className="w-full pb-24">
          {renderStatus('Pending transactions', pendingSections)}
          {morePendingCount > 0 && (
            <TouchableOpacity
              onPress={() =>
                navigation.navigate('transactions', { account, tab: 'Pending' })
              }>
              <View
                blur
                className="mt-4 flex items-center rounded-full border p-3"
                style={{
                  backgroundColor: theme.greys[800],
                  borderColor: theme.greys[700],
                }}>
                <Text size={14} bold>
                  {morePendingCount} more pending transaction
                  {morePendingCount > 1 ? 's' : ''}
                </Text>
              </View>
            </TouchableOpacity>
          )}
          {renderStatus('Confirmed transactions', confirmedSections)}
          <TouchableOpacity
            onPress={() =>
              navigation.navigate('transactions', {
                account,
              })
            }>
            <View
              blur
              className="mt-4 flex items-center rounded-full border p-3"
              style={{
                backgroundColor: theme.greys[800],
                borderColor: theme.greys[700],
              }}>
              <Text size={14} bold>
                View all ({filteredTransactions.length})
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      );
    }

    const HEADER_HEIGHT = 30;
    const ITEM_HEIGHT = 69;
    const getItemLayout = (data, index) => {
      let offset = 0;
      let itemIndex = index;

      for (let section of data) {
        // Add header height for each section
        offset += HEADER_HEIGHT;

        if (itemIndex < section.data.length) {
          // Item is in this section
          offset += ITEM_HEIGHT * itemIndex;
          return {
            length: ITEM_HEIGHT,
            offset,
            index,
          };
        } else {
          // Skip this whole section
          itemIndex -= section.data.length;
          offset += ITEM_HEIGHT * section.data.length;
        }
      }

      // Fallback
      return { length: ITEM_HEIGHT, offset: offset, index };
    };

    return (
      <SectionList
        style={{
          minHeight: Dimensions.get('screen').height,
        }}
        sections={allSections}
        keyExtractor={(item) => item.request || item.token}
        renderItem={({ item, section, index }) => {
          return (
            <View
              style={[
                {
                  backgroundColor: theme.greys[800],
                  borderRadius: 8,
                  borderTopLeftRadius: index === 0 ? 8 : 0,
                  borderTopRightRadius: index === 0 ? 8 : 0,
                  borderBottomLeftRadius: index === section.data.length - 1 ? 8 : 0,
                  borderBottomRightRadius: index === section.data.length - 1 ? 8 : 0,
                  height: ITEM_HEIGHT,
                },
              ]}>
              <Transaction key={item.request || item.token} tx={item} />
            </View>
          );
        }}
        renderSectionHeader={({ section: { title } }) => (
          <Text
            size={14}
            heavy
            color={theme.greys[500]}
            style={{
              height: HEADER_HEIGHT,
            }}
            className="mb-1 mt-2">
            {title}
          </Text>
        )}
        contentContainerStyle={{
          width: '100%',
          paddingBottom: 1000,
        }}
        maxToRenderPerBatch={3}
        windowSize={5}
        getItemLayout={getItemLayout}
        initialNumToRender={10}
      />
    );
  }
);

Transactions.displayName = 'Transactions';
