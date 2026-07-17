import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';

import { FlashList, type FlashListRef, type ViewToken } from '@shopify/flash-list';
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
import {
  findScrollIndexForMonth,
  monthItemsFromKeys,
  monthKeyOf,
  type MonthItem,
} from '@/features/transactions/lib/months';
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
} from 'wallet';
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
  /** "YYYY-MM" of the section's date — drives month jump + viewport tracking. */
  monthKey: string;
}

/** Imperative surface for the virtualized timeline (month pill jumps). */
export interface TransactionsHandle {
  scrollToMonth: (monthKey: string) => void;
}

const DATE_HEADER_HEIGHT = 30;

// Stable object: FlashList requires viewabilityConfig to keep its identity.
const MONTH_VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 20 };

// Reveal gate: how long the section content must hold still before the list
// is shown, and the cap after which it shows regardless (so a busy wallet
// with in-flight operations can't spin forever).
const SETTLE_DEBOUNCE_MS = 150;
const SETTLE_MAX_WAIT_MS = 700;

// FlashList v2 enables maintainVisibleContentPosition by default. On this
// list the header spacer grows after mount (native header measures late) and
// history arrives in waves (coco page + melts + annotations), so the anchor
// drifts and first paint lands scrolled below the top with the rows above it
// not yet drawn. A history timeline needs top-anchored behavior, not
// chat-style anchoring — disable it.
const MVCP_DISABLED = { disabled: true };

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
   * Reports the cancellable pending ecash sends in the rendered list (all
   * months — the list is one scrollable surface) so a parent screen can show
   * a "Cancel all" footer that respects the active non-month filters. Fires
   * on every filter/history change.
   */
  onVisiblePendingEcashChange?: (entries: SendHistoryEntry[]) => void;
  /**
   * Reports the months actually present in the rendered sections (newest
   * first) so a parent can render month pills that always match the list —
   * including swap-only months and post-annotation-filter gaps.
   */
  onMonthsChange?: (months: MonthItem[]) => void;
  /**
   * Reports the month of the topmost visible section as the user scrolls,
   * so a parent can highlight the month the viewport is currently on.
   */
  onVisibleMonthChange?: (monthKey: string) => void;
  /**
   * Infinite scroll: called when the list nears its end so the parent can
   * fetch the next history page (virtualized mode only).
   */
  onEndReached?: () => void;
  /** Imperative handle for month pill jumps (virtualized mode only). */
  ref?: React.Ref<TransactionsHandle>;
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
    onTransactionPress,
    onScroll,
    disableContentInsetAdjustment = false,
    onCancelPendingEcash,
    onVisiblePendingEcashChange,
    onMonthsChange,
    onVisibleMonthChange,
    onEndReached,
    ref,
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

      const swapItems: TimelineItem[] = swapGroups.map((group) => ({
        kind: 'swap' as const,
        data: group,
      }));

      return [...txItems, ...swapItems];
    }, [filteredHistory, swapGroups, filter, type, embedded]);

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
          monthKey: monthKeyOf(getTimelineCreatedAt(groupedByDate[dateString][0])),
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
      // Initial history fetch: coco's page hasn't landed yet, but the
      // persisted swap-group store hydrates synchronously — rendering swaps
      // alone paints an old month first, then every newer entry inserts
      // above it when the page arrives (log-confirmed: swap-only frame at
      // t+0, full 89-row frame at t+2s). Hold the list empty so the
      // isFetching spinner shows until real history is in.
      if (isFetching && filteredHistory.length === 0) return [];
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
    }, [sections, tab, isFetching, filteredHistory.length]);

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
          monthKey: monthKeyOf(getTimelineCreatedAt(groupedByDate[dateString][0])),
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

    // Reveal only after the list has settled ABOVE THE FOLD. History arrives
    // in waves (first coco page, self-filling onEndReached pages, annotation
    // and receive-supplement merges); frames shown as they land paint partial
    // content that visibly reshuffles. The FlashList stays mounted-but-
    // invisible so it measures beneath the spinner, and is revealed once the
    // HEAD of the list (first rows — what the user will actually see) has
    // held still for SETTLE_DEBOUNCE_MS, capped at SETTLE_MAX_WAIT_MS from
    // first data. Older pages appending BELOW deliberately do not restart
    // the debounce — appends don't move visible content, and small-page
    // chaining would otherwise defer the reveal to the cap every time. If
    // history is already loaded when this instance mounts, reveal
    // immediately.
    const [settled, setSettled] = useState(() => history.length > 0 && !isFetching);
    const hasSettleData = !(isFetching && filteredHistory.length === 0);
    const headSignature = useMemo(() => {
      const keys: string[] = [];
      for (const section of sectionsToDisplay) {
        for (const item of section.data) {
          keys.push(getTimelineKey(item));
          if (keys.length >= 12) return keys.join('|');
        }
      }
      return keys.join('|');
    }, [sectionsToDisplay]);
    useEffect(() => {
      if (settled || !hasSettleData) return;
      const timer = setTimeout(() => setSettled(true), SETTLE_DEBOUNCE_MS);
      return () => clearTimeout(timer);
      // headSignature restarts the debounce only when the top of the list
      // changes — "settled" means the visible head held still for a window.
    }, [settled, hasSettleData, headSignature]);
    useEffect(() => {
      if (settled || !hasSettleData) return;
      const timer = setTimeout(() => setSettled(true), SETTLE_MAX_WAIT_MS);
      return () => clearTimeout(timer);
      // No sectionsToDisplay here: this is the churn-proof upper bound.
    }, [settled, hasSettleData]);
    useEffect(() => {
      if (settled) {
        log.info('transactions.render.settled', { items: sectionsToDisplay.length });
      }
      // Log once on the transition; sectionsToDisplay is read, not a trigger.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settled]);

    // Render-order diagnostics: the exact order the list renders, one line
    // per change. Types + dates only — no amounts, mints, or tokens.
    const lastRenderSignatureRef = useRef('');
    useEffect(() => {
      const rows: string[] = [];
      for (const section of sectionsToDisplay) {
        for (const item of section.data) {
          rows.push(
            `${item.kind === 'swap' ? 'swap' : item.data.type}@${new Date(
              getTimelineCreatedAt(item)
            )
              .toISOString()
              .slice(0, 10)}`
          );
        }
      }
      const signature = rows.join(',');
      if (signature === lastRenderSignatureRef.current) return;
      lastRenderSignatureRef.current = signature;
      log.info('transactions.render.order', {
        tab,
        listKey: listKey ?? null,
        sections: sectionsToDisplay.length,
        items: rows.length,
        monthsInOrder: sectionsToDisplay.map((s) => s.monthKey).join(','),
        first30: rows.slice(0, 30).join(','),
        last5: rows.slice(-5).join(','),
      });
    }, [sectionsToDisplay, tab, listKey]);

    // Months present in the rendered sections, newest first. Emitted with a
    // signature guard (same pattern as the pending-ecash report) so the parent
    // only re-renders its pills when the month set actually changes. The
    // sentinel start value guarantees the first emission fires even when the
    // list mounts empty.
    const monthItems = useMemo(
      () => monthItemsFromKeys(sectionsToDisplay.map((section) => section.monthKey)),
      [sectionsToDisplay]
    );
    const lastMonthsSignatureRef = useRef<string | null>(null);
    useEffect(() => {
      if (!onMonthsChange) return;
      const signature = monthItems.map((m) => m.key).join('|');
      if (signature === lastMonthsSignatureRef.current) return;
      lastMonthsSignatureRef.current = signature;
      onMonthsChange(monthItems);
    }, [monthItems, onMonthsChange]);

    const flashListRef = useRef<FlashListRef<Section>>(null);

    // While a pill-triggered animated scroll is in flight, viewport-month
    // reports are suppressed — otherwise every intermediate month would
    // flicker through the pills on the way to the target.
    const programmaticScrollRef = useRef(false);

    useImperativeHandle(
      ref,
      () => ({
        scrollToMonth: (monthKey: string) => {
          const index = findScrollIndexForMonth(sectionsToDisplay, monthKey);
          log.info('transactions.month.scroll', {
            monthKey,
            index,
            exact: sectionsToDisplay[index]?.monthKey === monthKey,
            sections: sectionsToDisplay.length,
          });
          const list = flashListRef.current;
          if (index < 0 || !list) return;
          programmaticScrollRef.current = true;
          void list
            .scrollToIndex({ index, animated: true })
            .catch(() => {})
            .finally(() => {
              programmaticScrollRef.current = false;
            });
        },
      }),
      [sectionsToDisplay]
    );

    // FlashList requires onViewableItemsChanged to keep its identity, so the
    // latest callback is read through a ref instead of re-binding.
    const onVisibleMonthChangeRef = useRef(onVisibleMonthChange);
    useEffect(() => {
      onVisibleMonthChangeRef.current = onVisibleMonthChange;
    });
    const handleViewableItemsChanged = useCallback(
      ({ viewableItems }: { viewableItems: ViewToken<Section>[] }) => {
        if (programmaticScrollRef.current) return;
        // Topmost = lowest index; don't rely on the array's ordering.
        let top: ViewToken<Section> | undefined;
        for (const token of viewableItems) {
          if (!token.isViewable || token.index === null) continue;
          if (!top || token.index < (top.index as number)) top = token;
        }
        if (top?.item?.monthKey) onVisibleMonthChangeRef.current?.(top.item.monthKey);
      },
      []
    );

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
                        <Pressable
                          testID="transactions-view-all"
                          accessibilityLabel="View all transactions">
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
        <View style={styles.listContainer}>
          <View
            style={[styles.listContainer, !settled && styles.listHidden]}
            pointerEvents={settled ? 'auto' : 'none'}>
            <FlashList
              key={listKey}
              ref={flashListRef}
              style={{ flex: 1 }}
              // Android: this timeline renders inside the transactions form-sheet;
              // opt into nested scrolling so dragging it down scrolls the list
              // instead of dismissing the sheet. No-op when not sheet-nested.
              nestedScrollEnabled
              data={sectionsToDisplay}
              keyExtractor={(section) => section.index ?? section.title}
              // FlashList v2 measures section heights synchronously, so there is no
              // estimate to supply. A collapsing transaction row animates its own
              // height via Transaction.tsx's reanimated `layout` transition; the
              // sections below reflow as FlashList re-measures (the legend-only
              // `itemLayoutAnimation` that animated sibling reflow has no v2
              // equivalent, so that reflow is now immediate).
              drawDistance={400}
              maintainVisibleContentPosition={MVCP_DISABLED}
              onEndReached={onEndReached}
              // One full viewport of lookahead: with small history pages the
              // next fetch must start before the user reaches the end, or
              // fast scrolling hits a visible wait.
              onEndReachedThreshold={1}
              contentInsetAdjustmentBehavior={disableContentInsetAdjustment ? 'never' : 'automatic'}
              ListHeaderComponent={resolvedHeader}
              ListEmptyComponent={emptyComponent}
              onScroll={onScroll}
              scrollEventThrottle={16}
              // Grabbing the list mid-animation cancels the pill jump's claim on
              // the viewport: tracking resumes immediately (also a safety net if
              // the scrollToIndex promise never settles).
              onScrollBeginDrag={() => {
                programmaticScrollRef.current = false;
              }}
              onViewableItemsChanged={handleViewableItemsChanged}
              viewabilityConfig={MONTH_VIEWABILITY_CONFIG}
              renderItem={renderSection}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 250 }}
            />
          </View>
          {!settled && (
            <View style={styles.settleOverlay} pointerEvents="none">
              <Spinner size={22} />
            </View>
          )}
        </View>
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
  listContainer: {
    flex: 1,
  },
  // Kept mounted so FlashList measures and settles beneath the spinner.
  listHidden: {
    opacity: 0,
  },
  settleOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
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
