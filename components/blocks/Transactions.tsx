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
import { SwapTransactionRow } from 'components/blocks/SwapTransactionRow';
import _ from 'lodash';
import { mintHistoryEntryExpired } from 'helper/utils';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import opacity from 'hex-color-opacity';
import { BlurCardFrame } from 'components/ui/BlurCardFrame';
import { useSwapTransactionsStore, type SwapGroup } from 'stores/swapTransactionsStore';

// ---------------------------------------------------------------------------
// Timeline item: a discriminated union so transactions and swap groups can
// live in the same sorted list.
// ---------------------------------------------------------------------------

type TimelineItem = { kind: 'transaction'; data: HistoryEntry } | { kind: 'swap'; data: SwapGroup };

function getTimelineCreatedAt(item: TimelineItem): number {
  return item.data.createdAt;
}

function getTimelineKey(item: TimelineItem): string {
  if (item.kind === 'swap') return `swap-${item.data.id}`;
  const entry = item.data;
  if (entry.id) return entry.id;
  if ('token' in entry && entry.token)
    return typeof entry.token === 'string' ? entry.token : JSON.stringify(entry.token);
  return Math.random().toString();
}

// ---------------------------------------------------------------------------

interface Account {
  unit: string;
  type?: string;
}

interface Section {
  title: string;
  data: TimelineItem[];
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
  mintUrlFilter?: string;
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
    mintUrlFilter = 'all',
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
    const quoteIdToGroup = useSwapTransactionsStore((state) => state.quoteIdToGroup);
    const swapGroupsById = useSwapTransactionsStore((state) => state.groups);

    const swapGroups = useMemo(() => {
      if (account.unit === 'all') return Object.values(swapGroupsById);
      return Object.values(swapGroupsById).filter((g) => g.unit === account.unit);
    }, [swapGroupsById, account.unit]);

    const HEADER_HEIGHT = 30;
    const ITEM_HEIGHT = 69;

    const filteredHistory = useMemo(
      () =>
        _.filter(history, (historyEntry: HistoryEntry) => {
          if (account.unit !== 'all' && historyEntry.unit !== account.unit) return false;
          if (mintUrlFilter !== 'all' && historyEntry.mintUrl !== mintUrlFilter) return false;

          // Hide underlying child transactions that are part of a swap group
          if (historyEntry.type === 'mint' || historyEntry.type === 'melt') {
            const quoteId = (historyEntry as any).quoteId as string | undefined;
            if (quoteId && quoteIdToGroup[quoteId]) return false;
          }

          if (
            filter === 'incoming' &&
            historyEntry.type !== 'mint' &&
            historyEntry.type !== 'receive'
          )
            return false;
          if (filter === 'outgoing' && historyEntry.type !== 'send' && historyEntry.type !== 'melt')
            return false;
          if (type === 'lightning' && historyEntry.type !== 'mint' && historyEntry.type !== 'melt')
            return false;
          if (type === 'ecash' && historyEntry.type !== 'send' && historyEntry.type !== 'receive')
            return false;

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
      [
        history,
        account.unit,
        mintUrlFilter,
        filter,
        type,
        hideExpired,
        selectedMonth,
        quoteIdToGroup,
      ]
    );

    // Build unified timeline: mix history entries + swap groups chronologically
    const timelineItems: TimelineItem[] = useMemo(() => {
      const txItems: TimelineItem[] = filteredHistory.map((entry) => ({
        kind: 'transaction' as const,
        data: entry,
      }));

      // Only include swap items when showing all filters / types
      if (filter !== 'all' || type !== 'all') return txItems;

      const swapItems: TimelineItem[] = swapGroups
        .filter((group) => {
          if (!selectedMonth) return true;
          const [yearStr, monthStr] = selectedMonth.split('-');
          const filterYear = parseInt(yearStr, 10);
          const filterMonthNum = parseInt(monthStr, 10) - 1;
          const date = new Date(group.createdAt);
          return date.getFullYear() === filterYear && date.getMonth() === filterMonthNum;
        })
        .map((group) => ({
          kind: 'swap' as const,
          data: group,
        }));

      return [...txItems, ...swapItems];
    }, [filteredHistory, swapGroups, filter, type, selectedMonth]);

    const sortedTimeline = useMemo(
      () => _.orderBy(timelineItems, [(item) => getTimelineCreatedAt(item)], ['desc']),
      [timelineItems]
    );

    const { pending, confirmed, expired } = useMemo(
      () =>
        _.groupBy(sortedTimeline, (item: TimelineItem) => {
          // Swap items are always "confirmed"
          if (item.kind === 'swap') return 'confirmed';

          const historyEntry = item.data;
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
      [sortedTimeline]
    );

    const sections = useMemo(() => {
      const createSections = (items: TimelineItem[]) => {
        // Group by date string for display, but keep track of the original date for sorting
        const groupedByDate = _.groupBy(items, (item) => formatDate(getTimelineCreatedAt(item)));

        // Create an array of {dateString, originalDate} pairs for proper sorting
        const dateEntries = Object.keys(groupedByDate).map((dateString) => {
          const firstItem = groupedByDate[dateString][0];
          return {
            dateString,
            originalDate: new Date(getTimelineCreatedAt(firstItem)),
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

    /** Render a single timeline item (transaction or swap). */
    const renderTimelineItem = (item: TimelineItem) => {
      const key = getTimelineKey(item);
      if (item.kind === 'swap') {
        return <SwapTransactionRow key={key} group={item.data} />;
      }
      return <Transaction key={key} historyEntry={item.data} onPress={onTransactionPress} />;
    };

    const emptyComponent = useMemo(
      () => (
        <View style={{ paddingTop: 32 }}>
          <View style={[styles.card, { borderColor }]}>
            <BlurCardFrame accentColor={accentColor}>
              <View style={styles.emptyState}>
                <Icon
                  name="fluent:clock-12-filled"
                  size={36}
                  color={opacity(getPrimaryColor('0'), 0.33)}
                />
                <Text
                  size={16}
                  style={{
                    color: opacity(getPrimaryColor('0'), 0.66),
                    fontFamily: 'OverpassSemibold',
                    textAlign: 'center',
                  }}>
                  No transactions found
                </Text>
                <Text
                  size={14}
                  style={{
                    color: opacity(getPrimaryColor('0'), 0.4),
                    textAlign: 'center',
                  }}>
                  Try adjusting your filters or check back later
                </Text>
              </View>
            </BlurCardFrame>
          </View>
        </View>
      ),
      [accentColor, borderColor, getPrimaryColor]
    );

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
              color={opacity(getPrimaryColor('0'), 0.33)}
              spin={{
                duration: 1000,
                outputRange: ['0deg', '360deg'],
                delay: 0,
                easing: 'linear',
              }}
            />
            <Text heavy size={16} style={{ color: opacity(getPrimaryColor('0'), 0.66) }}>
              Loading Transactions...
            </Text>
            <Text color={opacity(getPrimaryColor('0'), 0.4)} size={16}>
              Please wait while we fetch your history
            </Text>
          </View>
        );
      }

      if (timelineItems.length === 0) {
        return (
          <View>
            <Spacer size={24} />
            <View style={[styles.card, { borderColor }]}>
              <BlurCardFrame accentColor={accentColor}>
                <View style={styles.emptyState}>
                  <Icon
                    name="fluent:clock-12-filled"
                    size={36}
                    color={opacity(getPrimaryColor('0'), 0.33)}
                  />
                  <Text
                    size={16}
                    style={{
                      color: opacity(getPrimaryColor('0'), 0.66),
                      fontFamily: 'OverpassSemibold',
                      textAlign: 'center',
                    }}>
                    No History
                  </Text>
                  <Text
                    size={14}
                    style={{
                      color: opacity(getPrimaryColor('0'), 0.4),
                      textAlign: 'center',
                    }}>
                    Your history will show up here
                  </Text>
                </View>
              </BlurCardFrame>
            </View>
          </View>
        );
      }

      const renderStatus = (label: string, sects: Section[]) => {
        if (sects.length === 0) return null;
        return (
          <View>
            <VStack spacing={8}>
              {sects.map((section) => (
                <View key={section.title}>
                  <VStack spacing={8}>
                    <View style={[styles.card, { borderColor }]}>
                      <BlurCardFrame accentColor={accentColor}>
                        <View style={styles.content}>
                          <View style={styles.sectionHeader}>
                            <Text heavy size={16} color={getPrimaryColor('0')}>
                              {label}
                            </Text>
                            <Text size={12} color={opacity(getPrimaryColor('0'), 0.66)}>
                              {section.title}
                            </Text>
                          </View>
                          {section.data.map(renderTimelineItem)}
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
        <View className="w-full">
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
        ListHeaderComponent={<View>{typeof header === 'function' ? header() : header}</View>}
        ListEmptyComponent={emptyComponent}
        onScroll={onScroll}
        scrollEventThrottle={16}
        renderItem={({ item: section }) => (
          <VStack spacing={4} style={{ marginBottom: 16 }}>
            <Text
              size={14}
              heavy
              color={opacity(getPrimaryColor('0'), 0.33)}
              style={{ height: HEADER_HEIGHT }}>
              {section.title}
            </Text>
            <View style={[styles.card, { borderColor }]}>
              <BlurCardFrame accentColor={accentColor}>
                <View style={styles.content}>{section.data.map(renderTimelineItem)}</View>
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
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
  },
  content: {
    zIndex: 1,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  viewAllButton: {
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
  },
  viewAllContent: {
    padding: 12,
    alignItems: 'center',
    zIndex: 1,
  },
  emptyState: {
    paddingVertical: 48,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 8,
    zIndex: 1,
  },
});
