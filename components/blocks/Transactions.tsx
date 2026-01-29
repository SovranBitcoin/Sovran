import React, { useMemo } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { LegendList } from '@legendapp/list';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { VStack } from 'components/ui/View/VStack';
import { Spacer } from 'components/ui/View/Spacer';
import { View } from 'components/ui/View/View';
import { Link } from 'expo-router';
import { HistoryEntry, MintHistoryEntry } from 'coco-cashu-core';
import { formatDate } from 'helper/time';
import { Transaction } from 'components/blocks/Transaction';
import _ from 'lodash';
import { mintHistoryEntryExpired } from 'helper/utils';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import opacity from 'hex-color-opacity';
import { BlurCardFrame } from 'components/ui/BlurCardFrame';

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
  isFetching?: boolean; // Loading state for fetching transactions
  // Filtering options
  filter?: 'all' | 'incoming' | 'outgoing';
  type?: 'all' | 'lightning' | 'ecash';
  at?: 'all' | 'at';
  tab?: 'All' | 'Confirmed' | 'Pending' | 'Expired';
  days?: number;
  hideExpired?: boolean; // If true, expired transactions will be filtered out
  /** Selected month for filtering (format: "YYYY-MM") */
  selectedMonth?: string | null;
  /** Optional custom press handler for transactions */
  onTransactionPress?: (historyEntry: HistoryEntry) => void;
  /** Optional scroll handler for tracking scroll position */
  onScroll?: (event: { nativeEvent: { contentOffset: { y: number } } }) => void;
  /**
   * When true, disables automatic content inset adjustment.
   * Use when header spacing is handled externally (e.g., via ModalLayoutWrapper).
   */
  disableContentInsetAdjustment?: boolean;
}

export const Transactions = React.memo(
  ({
    header,
    listKey,
    account,
    showMore,
    history,
    isFetching = false,
    filter = 'all',
    type = 'all',
    tab = 'All',
    days = 1,
    hideExpired = false,
    selectedMonth,
    onTransactionPress,
    onScroll,
    disableContentInsetAdjustment = false,
  }: Props) => {
    const { getPrimaryColor } = useTheme();

    // Theme colors for the card frame (matching payments style)
    const accentColor = useMemo(() => getPrimaryColor('300'), [getPrimaryColor]);
    const borderColor = useMemo(() => opacity(accentColor, 0.3), [accentColor]);

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

            // Filter out unpaid melt quotes
            if (historyEntry.type === 'melt' && historyEntry.state === 'UNPAID') {
              return false;
            }
          }

          // Filter by selected month if provided
          if (selectedMonth) {
            const [yearStr, monthStr] = selectedMonth.split('-');
            const filterYear = parseInt(yearStr, 10);
            const filterMonthNum = parseInt(monthStr, 10) - 1; // 0-indexed
            const date = new Date(historyEntry.createdAt);
            if (date.getFullYear() !== filterYear || date.getMonth() !== filterMonthNum) {
              return false;
            }
          }

          return true;
        }),
      [history, account.unit, filter, type, hideExpired, selectedMonth]
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
            (historyEntry.type === 'melt' && historyEntry.state === 'UNPAID') ||
            (historyEntry.type === 'send' &&
              (historyEntry.state === 'pending' || historyEntry.state === 'prepared'));

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

    const sectionsToDisplay = useMemo(() => {
      if (tab === 'Pending') return sections.pending;
      if (tab === 'Confirmed') return sections.confirmed;
      if (tab === 'Expired') return sections.expired;
      return sections.all;
    }, [sections, tab]);

    if (showMore) {
      if (isFetching) {
        return (
          <View
            className="flex items-center"
            style={{
              minHeight: Dimensions.get('screen').height / 2,
            }}>
            <Spacer size={24} />
            <Icon
              name="ant-design:loading-outlined"
              size={32}
              color={getPrimaryColor('500')}
              spin={{
                duration: 1000,
                outputRange: ['0deg', '360deg'],
                delay: 0,
                easing: 'linear',
              }}
            />
            <Text heavy size={16} style={{ color: getPrimaryColor('500') }}>
              Loading Transactions...
            </Text>
            <Text color={getPrimaryColor('500')} size={16}>
              Please wait while we fetch your history
            </Text>
          </View>
        );
      }

      if (filteredHistory.length === 0) {
        return (
          <View
            className="flex items-center"
            style={{
              minHeight: Dimensions.get('screen').height / 2,
            }}>
            <Spacer size={24} />
            <Icon name="fluent:clock-12-filled" size={32} color={getPrimaryColor('300')} />
            <Text heavy size={16} style={{ color: getPrimaryColor('300') }}>
              No History
            </Text>
            <Text color={getPrimaryColor('300')} size={16}>
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
                    <View style={[styles.card, { borderColor }]}>
                      <BlurCardFrame accentColor={accentColor}>
                        <View style={styles.content}>
                          {section.data.map((historyEntry) => {
                            const key = (() => {
                              if (historyEntry.id) return historyEntry.id;
                              if ('token' in historyEntry && historyEntry.token)
                                return typeof historyEntry.token === 'string'
                                  ? historyEntry.token
                                  : JSON.stringify(historyEntry.token);
                              return Math.random().toString();
                            })();
                            return (
                              <Transaction
                                key={key}
                                historyEntry={historyEntry}
                                onPress={onTransactionPress}
                              />
                            );
                          })}
                        </View>
                      </BlurCardFrame>
                    </View>
                    {label === 'Confirmed' && (
                      <Link
                        href={{
                          pathname: '/transactions',
                          params: {
                            account: JSON.stringify(account),
                            tab: 'Confirmed',
                          },
                        }}
                        asChild>
                        <TouchableOpacity>
                          <View style={[styles.viewAllButton, { borderColor }]}>
                            <BlurCardFrame accentColor={accentColor}>
                              <View style={styles.viewAllContent}>
                                <Text size={14} bold>
                                  View all ({filteredHistory.length})
                                </Text>
                              </View>
                            </BlurCardFrame>
                          </View>
                        </TouchableOpacity>
                      </Link>
                    )}
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

    // Estimate section height: header + (items * item height)
    const estimateSectionHeight = (section: Section) =>
      HEADER_HEIGHT + section.data.length * ITEM_HEIGHT + 16; // 16 for spacing

    return (
      <LegendList
        waitForInitialLayout={false}
        key={listKey}
        style={{ flex: 1 }}
        data={sectionsToDisplay}
        estimatedItemSize={estimateSectionHeight(sectionsToDisplay[0] || { data: [] })}
        scrollEnabled
        maintainVisibleContentPosition
        contentInsetAdjustmentBehavior={disableContentInsetAdjustment ? 'never' : 'automatic'}
        ListHeaderComponent={header}
        onScroll={onScroll}
        scrollEventThrottle={16}
        renderItem={({ item: section }) => (
          <VStack spacing={4} style={{ marginBottom: 16 }}>
            <Text size={14} heavy color={getPrimaryColor('500')} style={{ height: HEADER_HEIGHT }}>
              {section.title}
            </Text>
            <View style={[styles.card, { borderColor }]}>
              <BlurCardFrame accentColor={accentColor}>
                <View style={styles.content}>
                  {section.data.map((historyEntry) => {
                    const key = (() => {
                      if (historyEntry.id) return historyEntry.id;
                      if ('token' in historyEntry && historyEntry.token)
                        return typeof historyEntry.token === 'string'
                          ? historyEntry.token
                          : JSON.stringify(historyEntry.token);
                      return Math.random().toString();
                    })();
                    return (
                      <Transaction
                        key={key}
                        historyEntry={historyEntry}
                        onPress={onTransactionPress}
                      />
                    );
                  })}
                </View>
              </BlurCardFrame>
            </View>
          </VStack>
        )}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 250 }}
      />
    );
  }
);

Transactions.displayName = 'Transactions';

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
  },
  content: {
    zIndex: 1,
  },
  viewAllButton: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
  },
  viewAllContent: {
    padding: 12,
    alignItems: 'center',
    zIndex: 1,
  },
});
