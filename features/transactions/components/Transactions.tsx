import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';

import { FlashList } from '@shopify/flash-list';
import { Link } from 'expo-router';
import opacity from 'hex-color-opacity';
import groupBy from 'lodash/groupBy';
import orderBy from 'lodash/orderBy';

import { HistoryEntry, SendHistoryEntry } from '@cashu/coco-core';

import Icon from 'assets/icons';
import { SwapTransactionRow } from '@/features/transactions/components/SwapTransactionRow';
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
  bucketTransaction,
  getCounterparty,
  getScanSource,
  getSwap,
  isCancellablePendingEcash,
  isP2PKLocked,
  matchesTransactionFilters,
  type ScanMethod,
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

const DATE_HEADER_HEIGHT = 30;

interface Props {
  header?: React.ReactElement | (() => React.ReactElement) | null;
  listKey?: string;
  account: Account;
  showMore: boolean;
  /**
   * Embedded mode (use with `showMore`): renders the per-person/relationship
   * list inside another screen. Hides the global "View all" link, shows all
   * date groups (no `days` cap), and skips the swap-store injection so the list
   * is driven purely by the passed `history`.
   */
  embedded?: boolean;
  history: HistoryEntry[];
  isFetching?: boolean; // Loading state for fetching transactions
  // Filtering options
  filter?: TransactionDirection;
  type?: TransactionPaymentType;
  mintUrlFilter?: string;
  /** Annotation filters (default 'all'). */
  source?: 'all' | ScanMethod;
  lock?: 'all' | 'locked' | 'unlocked';
  counterparty?: 'all' | 'with';
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
    embedded = false,
    history,
    isFetching = false,
    filter = 'all',
    type = 'all',
    mintUrlFilter = 'all',
    source = 'all',
    lock = 'all',
    counterparty = 'all',
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
    // without this, the FlashList virtualizer recycles the view as soon as
    // its state flips to `rolledBack`, killing the animation mid-frame.
    const collapsing = useRollbackStore((s) => s.collapsing);

    const borderColor = useMemo(() => opacity(muted, 0.3), [muted]);
    const swapGroupsById = useSwapTransactionsStore((state) => state.groups);

    const swapGroups = useMemo(() => {
      if (account.unit === 'all') return Object.values(swapGroupsById);
      return Object.values(swapGroupsById).filter((g) => g.unit === account.unit);
    }, [swapGroupsById, account.unit]);

    const filteredHistory = useMemo(() => {
      const t0 = performance.now();
      const result = history.filter((historyEntry: HistoryEntry) => {
        if (account.unit !== 'all' && historyEntry.unit !== account.unit) return false;
        if (mintUrlFilter !== 'all' && historyEntry.mintUrl !== mintUrlFilter) return false;

        // Hide legs that belong to a swap group — colada surfaces the group as a
        // single row. The swap annotation (merged onto the entry) is the signal,
        // so the app no longer reaches into the swap store's quoteId index.
        if (getSwap(historyEntry)?.groupId) return false;

        if (!matchesTransactionFilters(historyEntry, { paymentType: type, direction: filter })) {
          return false;
        }

        // Annotation-driven filters (source/transport, P2PK lock, counterparty).
        if (source !== 'all' && getScanSource(historyEntry)?.method !== source) return false;
        if (lock !== 'all' && isP2PKLocked(historyEntry) !== (lock === 'locked')) return false;
        if (counterparty === 'with' && !getCounterparty(historyEntry)?.pubkey) return false;

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
      source,
      lock,
      counterparty,
      hideExpired,
      selectedMonth,
    ]);

    // Build unified timeline: mix history entries + swap groups chronologically
    const timelineItems: TimelineItem[] = useMemo(() => {
      const txItems: TimelineItem[] = filteredHistory.map((entry) => ({
        kind: 'transaction' as const,
        data: entry,
      }));

      // Only include swap items when showing all filters / types. Embedded mode
      // (per-person relationship view) is driven purely by the passed history —
      // swaps are self-rebalances with no counterparty, so never inject them.
      if (embedded || filter !== 'all' || type !== 'all') return txItems;

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

      return [...txItems, ...swapItems];
    }, [filteredHistory, swapGroups, filter, type, selectedMonth, embedded]);

    const sortedTimeline = useMemo(
      () => orderBy(timelineItems, [(item) => getTimelineCreatedAt(item)], ['desc']),
      [timelineItems]
    );

    const { pending, confirmed, expired } = useMemo(
      () =>
        groupBy(sortedTimeline, (item: TimelineItem) => {
          // Swap items are always "confirmed"
          if (item.kind === 'swap') return 'confirmed';

          const historyEntry = item.data;
          const isCollapsingGhost =
            historyEntry.type === 'send' &&
            collapsing.has((historyEntry as SendHistoryEntry).operationId);

          // Single colada classifier: handles expired mint quotes, pending
          // sends, and unredeemed (executing) receives in one place.
          return bucketTransaction(historyEntry, { isCollapsingGhost });
        }),
      [sortedTimeline, collapsing]
    );

    const sections = useMemo(() => {
      const t0 = performance.now();
      const createSections = (items: TimelineItem[], prefix: string) => {
        // Group by date string for display, but keep track of the original date for sorting
        const groupedByDate = groupBy(items, (item) =>
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
        const sortedDateEntries = orderBy(
          dateEntries,
          (entry) => entry.originalDate.getTime(),
          'desc'
        );

        // Embedded mode shows every date group (no `days` cap).
        const datesToShow =
          showMore && !embedded ? sortedDateEntries.slice(0, days) : sortedDateEntries;

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
    }, [pending, confirmed, expired, showMore, days, embedded]);

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

    // Embedded (per-person) list groups purely by date — no pending/confirmed/
    // expired split — so each date renders once under a single date header.
    const embeddedSections = useMemo<Section[]>(() => {
      if (!embedded) return [];
      const groupedByDate = groupBy(sortedTimeline, (item) =>
        formatDate(getTimelineCreatedAt(item), 'long-date')
      );
      const dateEntries = Object.keys(groupedByDate).map((dateString) => ({
        dateString,
        originalDate: new Date(getTimelineCreatedAt(groupedByDate[dateString][0])),
      }));
      return orderBy(dateEntries, (e) => e.originalDate.getTime(), 'desc').map(
        ({ dateString }) => ({
          title: dateString,
          data: groupedByDate[dateString],
          index: `embedded-${dateString}`,
        })
      );
    }, [embedded, sortedTimeline]);

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
      (item: TimelineItem, rowIndex?: number) => {
        const key = getTimelineKey(item);
        if (item.kind === 'swap') {
          return <SwapTransactionRow key={key} group={item.data} />;
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
      [onCancelPendingEcash, onTransactionPress]
    );

    const renderSection = useCallback(
      ({ item: section }: { item: Section; index?: number }) => (
        <VStack spacing={4} className="mb-4">
          <Text size={14} heavy color={opacity(foreground, 0.33)} style={styles.dateHeader}>
            {section.title}
          </Text>
          <View style={[styles.card, { borderColor }]}>
            <BlurCardFrame accentColor={muted}>
              <View style={styles.content}>
                {section.data.map((item, rowIndex) => renderTimelineItem(item, rowIndex))}
              </View>
            </BlurCardFrame>
          </View>
        </VStack>
      ),
      [borderColor, foreground, muted, renderTimelineItem]
    );

    const resolvedHeader = useMemo(
      () => <View>{typeof header === 'function' ? header() : header}</View>,
      [header]
    );

    const emptyComponent = useMemo(
      () =>
        // While the first page is in flight the list is empty, so this renders
        // in place of the rows. Match the feed's loading affordance (a centered
        // spinner) instead of flashing the "No transactions found" card, which
        // reads as "you have none" when we simply haven't loaded yet.
        isFetching ? (
          <Spinner size={22} style={{ alignSelf: 'center', marginTop: 48 }} />
        ) : (
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
      [borderColor, foreground, isFetching, muted]
    );

    if (embedded) {
      // Non-virtualized, date-grouped list for embedding inside a detail
      // screen's ScrollView (one date header per date, no status containers).
      return (
        <View className="w-full">
          {embeddedSections.map((section) => (
            <React.Fragment key={section.index ?? section.title}>
              {renderSection({ item: section })}
            </React.Fragment>
          ))}
        </View>
      );
    }

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
                    {label === 'Confirmed' && !embedded && (
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
        <FlashList
          key={listKey}
          style={{ flex: 1 }}
          data={sectionsToDisplay}
          keyExtractor={(section) => section.index ?? section.title}
          // FlashList v2 measures section heights synchronously, so there is no
          // estimate to supply. A collapsing transaction row animates its own
          // height via Transaction.tsx's reanimated `layout` transition; the
          // sections below reflow as FlashList re-measures (the legend-only
          // `itemLayoutAnimation` that animated sibling reflow has no v2
          // equivalent, so that reflow is now immediate).
          drawDistance={400}
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
  dateHeader: {
    height: DATE_HEADER_HEIGHT,
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
