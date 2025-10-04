import React, { useMemo } from 'react';
import { Dimensions, TouchableOpacity } from 'react-native';
import { LegendList } from '@legendapp/list';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { View, VStack, Spacer } from 'components/ui/View';
import { router } from 'expo-router';
import { HistoryEntry } from 'coco-cashu-core';
import { CocoTransactionAdapter } from 'helper/coco/typeAdapters';
import { formatDate } from 'helper/time';
import { Transaction } from 'components/blocks/Transaction';
import _ from 'lodash';

interface Account {
  unit: string;
  type?: string;
}

interface Section {
  title: string;
  data: CocoTransactionAdapter[];
  index?: string;
}

interface Props {
  header?: React.ReactElement | (() => React.ReactElement) | null;
  listKey?: string;
  account: Account;
  showMore: boolean;
  history: HistoryEntry[];
  // Filtering options
  filter?: 'all' | 'incoming' | 'outgoing';
  type?: 'all' | 'lightning' | 'ecash';
  at?: 'all' | 'at';
  tab?: 'All' | 'Confirmed' | 'Pending';
  days?: number;
}

export const Transactions = React.memo(
  ({
    header,
    listKey,
    account,
    showMore,
    history,
    filter = 'all',
    type = 'all',
    tab = 'All',
    days = 1,
  }: Props) => {
    const theme = useSelector(memoizedGetTheme);

    const HEADER_HEIGHT = 30;
    const ITEM_HEIGHT = 69;

    const filteredHistory = useMemo(
      () =>
        _.filter(history, (historyEntry: HistoryEntry) => {
          if (historyEntry.unit !== account.unit) return false;
          if (filter === 'incoming' && historyEntry.type !== 'mint') return false;
          if (filter === 'outgoing' && historyEntry.type !== 'send') return false;
          if (type === 'lightning' && historyEntry.type !== 'mint') return false;
          if (type === 'ecash' && historyEntry.type !== 'send') return false;
          return true;
        }),
      [history, account.unit, filter, type]
    );

    const sortedHistory = useMemo(
      () => _.orderBy(filteredHistory, ['createdAt'], ['desc']),
      [filteredHistory]
    );

    const { pending, confirmed } = useMemo(
      () =>
        _.groupBy(sortedHistory, (historyEntry: HistoryEntry) => {
          const isPending =
            (historyEntry.type === 'mint' && historyEntry.state === 'UNPAID') ||
            (historyEntry.type === 'melt' && historyEntry.state === 'UNPAID');

          return isPending ? 'pending' : 'confirmed';
        }),
      [sortedHistory]
    );

    const sections = useMemo(() => {
      const createSections = (historyEntries: HistoryEntry[]) => {
        const groupedByDate = _.groupBy(historyEntries, (historyEntry) =>
          formatDate(historyEntry.createdAt)
        );
        const sortedDates = _.orderBy(Object.keys(groupedByDate), (date) => new Date(date), 'desc');
        const datesToShow = showMore ? _.take(sortedDates, days) : sortedDates;

        return datesToShow.map((date) => ({
          title: date,
          data: groupedByDate[date],
          index: date,
        }));
      };

      const pendingSections = createSections(pending || []);
      const confirmedSections = createSections(confirmed || []);

      return {
        pending: pendingSections,
        confirmed: confirmedSections,
        all: [...pendingSections, ...confirmedSections],
      };
    }, [pending, confirmed, showMore, days]);

    const flattenedData = useMemo(() => {
      let sectionsToDisplay;
      if (tab === 'Pending') {
        sectionsToDisplay = sections.pending;
      } else if (tab === 'Confirmed') {
        sectionsToDisplay = sections.confirmed;
      } else {
        sectionsToDisplay = sections.all;
      }

      return _.flatMap(sectionsToDisplay, (section) => [
        { type: 'header', title: section.title },
        ..._.map(section.data, (historyEntry) => ({ type: 'item', historyEntry })),
      ]);
    }, [sections.all, sections.pending, sections.confirmed, tab]);

    if (showMore) {
      if (filteredHistory.length === 0) {
        return (
          <View
            className="flex items-center"
            style={{
              minHeight: Dimensions.get('screen').height / 2,
            }}>
            <Icon name="fluent:clock-12-filled" color={theme.greys[500]} />
            <Text heavy size={16} style={{ color: theme.greys[500] }}>
              No History
            </Text>
            <Text color={theme.greys[500]} heavy size={16}>
              Your history will show up here
            </Text>
          </View>
        );
      }

      const renderStatus = (label: string, sections: Section[]) => {
        if (sections.length === 0) return null;
        return (
          <View>
            <VStack spacing={8}>
              <Spacer size={8} />
              <Text heavy size={16} color={theme.greys[100]}>
                {label}
              </Text>
              {sections.map((section) => (
                <View key={section.title}>
                  <VStack spacing={4}>
                    <Text size={14} heavy color={theme.greys[100]}>
                      {section.title}
                    </Text>
                    <View style={{ backgroundColor: theme.greys[900] }} className="rounded-lg" blur>
                      {section.data.map((historyEntry) => (
                        <Transaction
                          key={
                            historyEntry.id ||
                            historyEntry.request ||
                            historyEntry.token ||
                            Math.random().toString()
                          }
                          historyEntry={historyEntry}
                        />
                      ))}
                      {label === 'Confirmed' && (
                        <TouchableOpacity
                          onPress={() =>
                            router.push({
                              pathname: '/transactions',
                              params: {
                                account: JSON.stringify(account),
                                tab: 'Confirmed',
                              },
                            })
                          }>
                          <View
                            blur
                            className="flex items-center rounded-lg border p-3"
                            style={{
                              backgroundColor: theme.greys[800],
                              borderColor: theme.greys[700],
                            }}>
                            <Text size={14} bold>
                              View all ({filteredHistory.length})
                            </Text>
                          </View>
                        </TouchableOpacity>
                      )}
                    </View>
                  </VStack>
                </View>
              ))}
            </VStack>
          </View>
        );
      };

      return (
        <View className="w-full pb-24">
          {renderStatus('Pending', sections.pending)}
          {renderStatus('Confirmed', sections.confirmed)}
        </View>
      );
    }

    return (
      <LegendList
        waitForInitialLayout={false}
        key={listKey}
        style={{ height: Dimensions.get('screen').height, overflow: 'hidden' }}
        data={flattenedData}
        estimatedItemSize={ITEM_HEIGHT}
        scrollEnabled
        maintainVisibleContentPosition
        ListHeaderComponent={header}
        renderItem={({ item, index }) => {
          if (item.type === 'header') {
            return (
              <Text size={14} heavy color={theme.greys[500]} style={{ height: HEADER_HEIGHT }}>
                {'title' in item ? item.title : ''}
              </Text>
            );
          }

          const prev = flattenedData[index - 1];
          const next = flattenedData[index + 1];
          const isFirst = !prev || prev.type === 'header';
          const isLast = !next || next.type === 'header';

          return (
            <View
              blur
              style={{
                backgroundColor: theme.greys[800],
                borderRadius: 8,
                borderTopLeftRadius: isFirst ? 8 : 0,
                borderTopRightRadius: isFirst ? 8 : 0,
                borderBottomLeftRadius: isLast ? 8 : 0,
                borderBottomRightRadius: isLast ? 8 : 0,
                height: ITEM_HEIGHT,
              }}>
              {'historyEntry' in item && <Transaction historyEntry={item.historyEntry} />}
            </View>
          );
        }}
        contentContainerStyle={{ width: '100%', paddingBottom: 250 }}
      />
    );
  }
);

Transactions.displayName = 'Transactions';
