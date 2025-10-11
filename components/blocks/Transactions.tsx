import React, { useMemo } from 'react';
import { Dimensions } from 'react-native';
import { LegendList } from '@legendapp/list';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { View, VStack, Spacer } from 'components/ui/View';
import { router } from 'expo-router';
import { HistoryEntry, MintHistoryEntry } from 'coco-cashu-core';
import { formatDate } from 'helper/time';
import { Transaction } from 'components/blocks/Transaction';
import _ from 'lodash';
import { mintHistoryEntryExpired } from 'helper/utils';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';

interface Account {
  unit: string;
  type?: string;
}

interface Section {
  title: string;
  data: HistoryEntry[];
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
  tab?: 'All' | 'Confirmed' | 'Pending' | 'Expired';
  days?: number;
  hideExpired?: boolean; // If true, expired transactions will be filtered out
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
    hideExpired = false,
  }: Props) => {
    const { getPrimaryColor } = useTheme();

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

          // Filter out expired transactions if hideExpired is true
          if (hideExpired) {
            const isExpired =
              historyEntry.type === 'mint' &&
              historyEntry.state === 'UNPAID' &&
              mintHistoryEntryExpired(historyEntry as MintHistoryEntry);
            if (isExpired) return false;
          }

          return true;
        }),
      [history, account.unit, filter, type, hideExpired]
    );

    const sortedHistory = useMemo(
      () => _.orderBy(filteredHistory, ['createdAt'], ['desc']),
      [filteredHistory]
    );

    const { pending, confirmed, expired } = useMemo(
      () =>
        _.groupBy(sortedHistory, (historyEntry: HistoryEntry) => {
          const isPending =
            (historyEntry.type === 'mint' && historyEntry.state === 'UNPAID') ||
            (historyEntry.type === 'melt' && historyEntry.state === 'UNPAID');

          // Check if it's an expired mint transaction
          const isExpired =
            historyEntry.type === 'mint' &&
            historyEntry.state === 'UNPAID' &&
            mintHistoryEntryExpired(historyEntry as MintHistoryEntry);

          if (isExpired) return 'expired';
          return isPending ? 'pending' : 'confirmed';
        }),
      [sortedHistory]
    );

    const sections = useMemo(() => {
      const createSections = (historyEntries: HistoryEntry[]) => {
        // Group by date string for display, but keep track of the original date for sorting
        const groupedByDate = _.groupBy(historyEntries, (historyEntry) =>
          formatDate(historyEntry.createdAt)
        );

        // Create an array of {dateString, originalDate} pairs for proper sorting
        const dateEntries = Object.keys(groupedByDate).map((dateString) => {
          // Find the first history entry for this date to get the original createdAt
          const firstEntry = groupedByDate[dateString][0];
          return {
            dateString,
            originalDate: new Date(firstEntry.createdAt),
          };
        });

        // Sort by original date in descending order (newest first)
        const sortedDateEntries = _.orderBy(
          dateEntries,
          (entry) => entry.originalDate.getTime(),
          'desc'
        );

        const datesToShow = showMore ? _.take(sortedDateEntries, days) : sortedDateEntries;

        return datesToShow.map(({ dateString }) => ({
          title: dateString,
          data: groupedByDate[dateString],
          index: dateString,
        }));
      };

      const pendingSections = createSections(pending || []);
      const confirmedSections = createSections(confirmed || []);
      const expiredSections = createSections(expired || []);

      return {
        pending: pendingSections,
        confirmed: confirmedSections,
        expired: expiredSections,
        all: [...pendingSections, ...confirmedSections, ...expiredSections],
      };
    }, [pending, confirmed, expired, showMore, days]);

    const flattenedData = useMemo(() => {
      let sectionsToDisplay;
      if (tab === 'Pending') {
        sectionsToDisplay = sections.pending;
      } else if (tab === 'Confirmed') {
        sectionsToDisplay = sections.confirmed;
      } else if (tab === 'Expired') {
        sectionsToDisplay = sections.expired;
      } else {
        sectionsToDisplay = sections.all;
      }

      return _.flatMap(sectionsToDisplay, (section) => [
        { type: 'header', title: section.title },
        ..._.map(section.data, (historyEntry) => ({ type: 'item', historyEntry })),
      ]);
    }, [sections.all, sections.pending, sections.confirmed, sections.expired, tab]);

    if (showMore) {
      if (filteredHistory.length === 0) {
        return (
          <View
            className="flex items-center"
            style={{
              minHeight: Dimensions.get('screen').height / 2,
            }}>
            <Spacer size={24} />
            <Icon name="fluent:clock-12-filled" size={32} color={getPrimaryColor('500')} />
            <Text heavy size={16} style={{ color: getPrimaryColor('500') }}>
              No History
            </Text>
            <Text color={getPrimaryColor('500')} size={16}>
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
              <Text heavy size={16} color={getPrimaryColor('100')}>
                {label}
              </Text>
              {sections.map((section) => (
                <View key={section.title}>
                  <VStack spacing={4}>
                    <Text size={14} heavy color={getPrimaryColor('100')}>
                      {section.title}
                    </Text>
                    <View className="rounded-lg bg-primary-900" blur>
                      {section.data.map((historyEntry) => {
                        const key = (() => {
                          if (historyEntry.id) return historyEntry.id;
                          if ('token' in historyEntry && historyEntry.token)
                            return typeof historyEntry.token === 'string'
                              ? historyEntry.token
                              : JSON.stringify(historyEntry.token);
                          return Math.random().toString();
                        })();
                        return <Transaction key={key} historyEntry={historyEntry} />;
                      })}
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
                            className="flex items-center rounded-lg border border-primary-700 bg-primary-800 p-3">
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
          {renderStatus('Expired', sections.expired)}
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
              <Text
                size={14}
                heavy
                color={getPrimaryColor('500')}
                style={{ height: HEADER_HEIGHT }}>
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
              className="bg-primary-800"
              style={{
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
