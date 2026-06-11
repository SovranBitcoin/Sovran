import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Easing, LinearTransition } from 'react-native-reanimated';

import { AnimatedLegendList } from '@legendapp/list/reanimated';
import { Link } from 'expo-router';
import opacity from 'hex-color-opacity';
import _ from 'lodash';

import {
  HistoryEntry,
  MeltHistoryEntry,
  MintHistoryEntry,
  SendHistoryEntry,
} from '@cashu/coco-core';

import Icon from 'assets/icons';
import { SwapTransactionRow } from '@/features/transactions/components/SwapTransactionRow';
import { SplitBillTransactionRow } from '@/features/transactions/components/SplitBillTransactionRow';
import { Transaction } from '@/features/transactions/components/Transaction';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { formatDate } from '@/shared/lib/date';
import { mintHistoryEntryExpired } from '@/shared/lib/utils';
import {
  isCancellablePendingEcash,
  isPendingTransaction,
  matchesTransactionFilters,
  type TransactionDirection,
  type TransactionPaymentType,
} from '@sovranbitcoin/colada';
import { log, Log } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { spacing, zIndex } from '@/shared/styles/tokens';
import { useRollbackStore } from '@/shared/stores/runtime/rollbackStore';
import {
  useSwapTransactionsStore,
  type SwapGroup,
} from '@/shared/stores/profile/swapTransactionsStore';
import {
  useSplitBillTransactionsStore,
  type SplitBillGroup,
} from '@/shared/stores/profile/splitBillTransactionsStore';

// ---------------------------------------------------------------------------
// Timeline item: a discriminated union so transactions and swap groups can
// live in the same sorted list.
// ---------------------------------------------------------------------------

type TimelineItem =
  | { kind: 'transaction'; data: HistoryEntry }
  | { kind: 'swap'; data: SwapGroup }
  | { kind: 'split-bill'; data: SplitBillGroup };

function getTimelineCreatedAt(item: TimelineItem): number {
  return item.data.createdAt;
}

function getTimelineKey(item: TimelineItem): string {
  if (item.kind === 'swap') return `swap-${item.data.id}`;
  if (item.kind === 'split-bill') return `split-bill-${item.data.id}`;
  const entry = item.data;
  if (entry.id) return entry.id;
  // Bearer tokens MUST NOT become React keys; Math.random() destroys list
  // diffing. Derive a deterministic composite from invariant fields.
  return `${entry.type}-${entry.createdAt}-${entry.amount}`;
}

// ---------------------------------------------------------------------------

interface Account {
  unit: string;
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
  filter?: TransactionDirection;
  type?: TransactionPaymentType;
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
  /**
   * Cancel a single pending ecash send. When provided, cancellable rows
   * become left-swipeable; the swipe-commit handler calls this with the
   * full SendHistoryEntry.
   */
  onCancelPendingEcash?: (entry: SendHistoryEntry) => void;
  /**
   * Reports the currently-visible (post-filter) pending ecash sends so a
   * parent screen can show a "Cancel all" footer that respects active
   * filters. Fires on every filter/history change.
   */
  onVisiblePendingEcashChange?: (entries: SendHistoryEntry[]) => void;
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
    onCancelPendingEcash,
    onVisiblePendingEcashChange,
  }: Props) => {
    const [muted, foreground] = useThemeColor(['muted', 'foreground'] as const);
    const { height: screenHeight } = useWindowDimensions();

    // Operation ids that are still showing the post-success collapse
    // animation. Keeping them pinned in the Pending bucket gives the
    // Transaction row time to play its height-collapse before unmount —
    // without this, the LegendList virtualizer recycles the view as soon as
    // its state flips to `rolledBack`, killing the animation mid-frame.
    const collapsing = useRollbackStore((s) => s.collapsing);

    const borderColor = useMemo(() => opacity(muted, 0.3), [muted]);
    const quoteIdToGroup = useSwapTransactionsStore((state) => state.quoteIdToGroup);
    const swapGroupsById = useSwapTransactionsStore((state) => state.groups);
    const quoteIdToSplitBill = useSplitBillTransactionsStore((state) => state.quoteIdToSplitBill);
    const splitBillGroupsById = useSplitBillTransactionsStore((state) => state.groups);

    const swapGroups = useMemo(() => {
      if (account.unit === 'all') return Object.values(swapGroupsById);
      return Object.values(swapGroupsById).filter((g) => g.unit === account.unit);
    }, [swapGroupsById, account.unit]);

    const splitBillGroups = useMemo(() => {
      if (account.unit === 'all') return Object.values(splitBillGroupsById);
      return Object.values(splitBillGroupsById).filter((g) => g.unit === account.unit);
    }, [splitBillGroupsById, account.unit]);

    const HEADER_HEIGHT = 30;
    const ITEM_HEIGHT = 69;

    const filteredHistory = useMemo(() => {
      const t0 = performance.now();
      const result = _.filter(history, (historyEntry: HistoryEntry) => {
        if (account.unit !== 'all' && historyEntry.unit !== account.unit) return false;
        if (mintUrlFilter !== 'all' && historyEntry.mintUrl !== mintUrlFilter) return false;

        if (historyEntry.type === 'mint' || historyEntry.type === 'melt') {
          const quoteId = (historyEntry as MintHistoryEntry | MeltHistoryEntry).quoteId;
          if (quoteId && quoteIdToGroup[quoteId]) return false;
          // Also hide individual mint entries that belong to a split-bill
          // group — they're surfaced through the meta-row instead.
          if (quoteId && quoteIdToSplitBill[quoteId]) return false;
        }

        if (!matchesTransactionFilters(historyEntry, { paymentType: type, direction: filter })) {
          return false;
        }

        // Filter out expired transactions if hideExpired is true
        if (hideExpired) {
          const isExpired =
            historyEntry.type === 'mint' &&
            String(historyEntry.state) === 'UNPAID' &&
            mintHistoryEntryExpired(historyEntry);
          if (isExpired) return false;

          // Filter out unpaid melt quotes
          if (historyEntry.type === 'melt' && String(historyEntry.state) === 'UNPAID') {
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
      });
      const duration = Math.round((performance.now() - t0) * 100) / 100;
      if (duration > 20) {
        log.warn('transactions.filter.slow', {
          duration_ms: duration,
          input: history.length,
          output: result.length,
        });
      }
      return result;
    }, [
      history,
      account.unit,
      mintUrlFilter,
      filter,
      type,
      hideExpired,
      selectedMonth,
      quoteIdToGroup,
      quoteIdToSplitBill,
    ]);

    // Build unified timeline: mix history entries + swap groups chronologically
    const timelineItems: TimelineItem[] = useMemo(() => {
      const txItems: TimelineItem[] = filteredHistory.map((entry) => ({
        kind: 'transaction' as const,
        data: entry,
      }));

      // Only include swap items when showing all filters / types
      if (filter !== 'all' || type !== 'all') return txItems;

      const monthFilter = (createdAt: number) => {
        if (!selectedMonth) return true;
        const [yearStr, monthStr] = selectedMonth.split('-');
        const filterYear = parseInt(yearStr, 10);
        const filterMonthNum = parseInt(monthStr, 10) - 1;
        const date = new Date(createdAt);
        return date.getFullYear() === filterYear && date.getMonth() === filterMonthNum;
      };

      const swapItems: TimelineItem[] = swapGroups
        .filter((group) => monthFilter(group.createdAt))
        .map((group) => ({
          kind: 'swap' as const,
          data: group,
        }));

      const splitBillItems: TimelineItem[] = splitBillGroups
        .filter((group) => monthFilter(group.createdAt))
        .map((group) => ({
          kind: 'split-bill' as const,
          data: group,
        }));

      return [...txItems, ...swapItems, ...splitBillItems];
    }, [filteredHistory, swapGroups, splitBillGroups, filter, type, selectedMonth]);

    const sortedTimeline = useMemo(
      () => _.orderBy(timelineItems, [(item) => getTimelineCreatedAt(item)], ['desc']),
      [timelineItems]
    );

    const { pending, confirmed, expired } = useMemo(
      () =>
        _.groupBy(sortedTimeline, (item: TimelineItem) => {
          // Swap items are always "confirmed"
          if (item.kind === 'swap') return 'confirmed';
          if (item.kind === 'split-bill') {
            // Bucket split-bill groups into pending until fully paid.
            if (item.data.state === 'paid') return 'confirmed';
            if (item.data.state === 'expired' || item.data.state === 'cancelled') return 'expired';
            return 'pending';
          }

          const historyEntry = item.data;
          const isCollapsingGhost =
            historyEntry.type === 'send' &&
            collapsing.has((historyEntry as SendHistoryEntry).operationId);
          const isPending = isPendingTransaction(historyEntry, { isCollapsingGhost });

          // Check if it's an expired mint transaction
          const isExpired =
            historyEntry.type === 'mint' &&
            String(historyEntry.state) === 'UNPAID' &&
            mintHistoryEntryExpired(historyEntry);

          if (isExpired) return 'expired';
          return isPending ? 'pending' : 'confirmed';
        }),
      [sortedTimeline, collapsing]
    );

    const sections = useMemo(() => {
      const t0 = performance.now();
      const createSections = (items: TimelineItem[], prefix: string) => {
        // Group by date string for display, but keep track of the original date for sorting
        const groupedByDate = _.groupBy(items, (item) =>
          formatDate(getTimelineCreatedAt(item), 'long-date')
        );

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
          index: `${prefix}-${dateString}`,
        }));
      };

      const pendingSections = createSections(pending || [], 'pending');
      const confirmedSections = createSections(confirmed || [], 'confirmed');
      const expiredSections = createSections(expired || [], 'expired');

      const result = {
        pending: pendingSections,
        confirmed: confirmedSections,
        expired: expiredSections,
        all: [...pendingSections, ...confirmedSections, ...expiredSections],
      };
      const duration = Math.round((performance.now() - t0) * 100) / 100;
      if (duration > 20) {
        log.warn('transactions.sections.slow', {
          duration_ms: duration,
          pending: pendingSections.length,
          confirmed: confirmedSections.length,
          expired: expiredSections.length,
        });
      }
      return result;
    }, [pending, confirmed, expired, showMore, days]);

    const sectionsToDisplay = useMemo(() => {
      log.debug('transactions.sections_computed', {
        tab,
        pending: sections.pending.length,
        confirmed: sections.confirmed.length,
        expired: sections.expired.length,
        total: sections.all.length,
      });
      if (tab === 'Pending') return sections.pending;
      if (tab === 'Confirmed') return sections.confirmed;
      if (tab === 'Expired') return sections.expired;
      return sections.all;
    }, [sections, tab]);

    // Cancellable subset of the visible pending bucket: ecash sends only.
    // Used by the parent screen to drive the "Cancel N pending" footer.
    const visiblePendingEcash = useMemo<SendHistoryEntry[]>(() => {
      const out: SendHistoryEntry[] = [];
      for (const item of pending || []) {
        if (item.kind === 'transaction' && isCancellablePendingEcash(item.data)) {
          out.push(item.data);
        }
      }
      return out;
    }, [pending]);

    // Only emit when the cancellable id-set actually changes — `pending`'s
    // reference churns on every history mutation, but the screen only
    // cares when a cancellable row appears or disappears.
    const lastEmittedSignatureRef = useRef<string>('');
    useEffect(() => {
      if (!onVisiblePendingEcashChange) return;
      const signature = visiblePendingEcash.map((e) => e.operationId).join('|');
      if (signature === lastEmittedSignatureRef.current) return;
      lastEmittedSignatureRef.current = signature;
      onVisiblePendingEcashChange(visiblePendingEcash);
    }, [visiblePendingEcash, onVisiblePendingEcashChange]);

    const renderTimelineItem = useCallback(
      (item: TimelineItem) => {
        const key = getTimelineKey(item);
        if (item.kind === 'swap') {
          return <SwapTransactionRow key={key} group={item.data} />;
        }
        if (item.kind === 'split-bill') {
          return <SplitBillTransactionRow key={key} group={item.data} />;
        }
        return (
          <Transaction
            key={key}
            historyEntry={item.data}
            onPress={onTransactionPress}
            onCancel={onCancelPendingEcash}
          />
        );
      },
      [onTransactionPress, onCancelPendingEcash]
    );

    const getFixedItemSize = useCallback((section: Section): number | undefined => {
      // Pure transaction sections are uniform-height, so we can hand LegendList
      // an exact fixed size (fast path, no measurement). Sections containing
      // swap or split-bill rows have content-dependent heights — trusting the
      // 69px-per-row constant there mis-sized them and caused overlap, gaps,
      // and scroll jumps. Returning `undefined` tells LegendList to measure
      // those sections instead.
      const hasVariableRow = section.data.some(
        (item) => item.kind === 'swap' || item.kind === 'split-bill'
      );
      if (hasVariableRow) return undefined;
      return HEADER_HEIGHT + section.data.length * ITEM_HEIGHT + 16;
    }, []);

    const renderSection = useCallback(
      ({ item: section }: { item: Section }) => (
        <VStack spacing={4} className="mb-4">
          <Text size={14} heavy color={opacity(foreground, 0.33)} style={{ height: HEADER_HEIGHT }}>
            {section.title}
          </Text>
          <View style={[styles.card, { borderColor }]}>
            <BlurCardFrame accentColor={muted}>
              <View style={styles.content}>{section.data.map(renderTimelineItem)}</View>
            </BlurCardFrame>
          </View>
        </VStack>
      ),
      [foreground, muted, borderColor, renderTimelineItem]
    );

    const resolvedHeader = useMemo(
      () => <View>{typeof header === 'function' ? header() : header}</View>,
      [header]
    );

    const emptyComponent = useMemo(
      () => (
        <View className="pt-8">
          <View style={[styles.card, { borderColor }]}>
            <BlurCardFrame accentColor={muted}>
              <View style={styles.emptyState}>
                <Icon name="fluent:clock-12-filled" size={36} color={opacity(foreground, 0.33)} />
                <Text
                  size={16}
                  style={{
                    color: opacity(foreground, 0.66),
                    fontFamily: 'OxygenBold',
                    textAlign: 'center',
                  }}>
                  No transactions found
                </Text>
                <Text
                  size={14}
                  style={{
                    color: opacity(foreground, 0.4),
                    textAlign: 'center',
                  }}>
                  Try adjusting your filters or check back later
                </Text>
              </View>
            </BlurCardFrame>
          </View>
        </View>
      ),
      [muted, borderColor, foreground]
    );

    if (showMore) {
      if (isFetching) {
        return (
          <View
            className="flex items-center"
            style={{
              minHeight: screenHeight / 2,
            }}>
            <Spacer size={24} />
            <Spinner size={32} color={opacity(foreground, 0.33)} />
            <Text heavy size={16} style={{ color: opacity(foreground, 0.66) }}>
              Loading Transactions...
            </Text>
            <Text color={opacity(foreground, 0.4)} size={16}>
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
              <BlurCardFrame accentColor={muted}>
                <View style={styles.emptyState}>
                  <Icon name="fluent:clock-12-filled" size={36} color={opacity(foreground, 0.33)} />
                  <Text
                    size={16}
                    style={{
                      color: opacity(foreground, 0.66),
                      fontFamily: 'OxygenBold',
                      textAlign: 'center',
                    }}>
                    No History
                  </Text>
                  <Text
                    size={14}
                    style={{
                      color: opacity(foreground, 0.4),
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
                      <BlurCardFrame accentColor={muted}>
                        <View style={styles.content}>
                          <View style={styles.sectionHeader}>
                            <Text heavy size={16} color={foreground}>
                              {label}
                            </Text>
                            <Text size={12} color={opacity(foreground, 0.66)}>
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
                            filterCurrency: account.unit,
                            filterStatus: 'Confirmed',
                          },
                        }}
                        asChild>
                        <Pressable>
                          <View style={[styles.viewAllButton, { borderColor }]}>
                            <BlurCardFrame accentColor={muted}>
                              <View style={styles.viewAllContent}>
                                <Text size={14} bold>
                                  View all ({filteredHistory.length})
                                </Text>
                              </View>
                            </BlurCardFrame>
                          </View>
                        </Pressable>
                      </Link>
                    )}
                  </VStack>
                </View>
              ))}
            </VStack>
          </View>
        );
      };

      const hasPending = sections.pending.length > 0;
      const hasExpired = sections.expired.length > 0;
      const hasConfirmed = sections.confirmed.length > 0;

      return (
        <View className="w-full">
          {renderStatus('Pending', sections.pending)}
          {hasPending && (hasExpired || hasConfirmed) && <Spacer size={spacing['sm']} />}
          {renderStatus('Expired', sections.expired)}
          {hasExpired && hasConfirmed && <Spacer size={spacing['sm']} />}
          {renderStatus('Confirmed', sections.confirmed)}
        </View>
      );
    }

    return (
      <Log name="Transactions">
        <AnimatedLegendList
          key={listKey}
          style={{ flex: 1 }}
          data={sectionsToDisplay}
          keyExtractor={(section) => section.index ?? section.title}
          getFixedItemSize={getFixedItemSize}
          estimatedItemSize={HEADER_HEIGHT + ITEM_HEIGHT + 16}
          maintainVisibleContentPosition
          // One-frame transition. AnimatedLegendList's `itemLayoutAnimation`
          // triggers a fresh LinearTransition on every measured-position
          // change. With a long duration each delta would start a 260 ms
          // animation that gets cancelled by the next frame's update — so
          // the next section perpetually chases the target with a quarter-
          // second lag. With a one-frame duration, each delta resolves
          // before the next arrives, producing real-time tracking that
          // moves in lock-step with the row's `layout` shrink.
          itemLayoutAnimation={LinearTransition.duration(16).easing(Easing.linear)}
          contentInsetAdjustmentBehavior={disableContentInsetAdjustment ? 'never' : 'automatic'}
          ListHeaderComponent={resolvedHeader}
          ListEmptyComponent={emptyComponent}
          onScroll={onScroll}
          scrollEventThrottle={16}
          renderItem={renderSection}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 250 }}
        />
      </Log>
    );
  }
);

Transactions.displayName = 'Transactions';

const styles = StyleSheet.create({
  // Plain View, NOT SquircleView: react-native-fast-squircle's RN-0.83 source
  // set has a no-op dispatchDraw (no child clipping), so squircle cards whose
  // visible fill is a child (BlurCardFrame's absolute-fill) render SQUARE on
  // Android. Plain View clips children to borderRadius correctly; iOS keeps
  // continuous corners via borderCurve.
  card: {
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
  },
  content: {
    zIndex: zIndex.raised,
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
    zIndex: zIndex.raised,
  },
  emptyState: {
    paddingVertical: 48,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 8,
    zIndex: zIndex.raised,
  },
});
