/**
 * @fileoverview Shared Transactions screen component
 *
 * This module provides the core UI and logic for the transactions list.
 * It is used by both standalone and flow-based route wrappers.
 *
 * Features:
 * - Native Stack header handles title and buttons
 * - Sticky month selector with blur/gradient below header (via Screen)
 * - One virtualized transaction list across all months: month pills jump the
 *   list to the first section of that month, and manual scrolling moves the
 *   pill highlight to the month currently at the top of the viewport.
 * - Filter support via external props (from filter flow)
 * - Inline pending-ecash sweep: when tab=Pending and the visible bucket has
 *   cancellable ecash sends, surfaces a "Cancel N pending" footer that
 *   reclaims every visible row, plus per-row swipe-to-cancel.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from '@/shared/ui/primitives/View/View';
import {
  Transactions,
  type TransactionsHandle,
} from '@/features/transactions/components/Transactions';
import { MonthSelector } from '@/features/transactions/components/MonthSelector';
import type { MonthItem } from '@/features/transactions/lib/months';
import { HistoryEntry, SendHistoryEntry } from '@cashu/coco-core';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { useHistoryWithMelts } from '@/features/transactions/hooks/useHistoryWithMelts';
import { Screen } from '@/shared/ui/composed/Screen';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { paramPopup, staticPopup } from '@/shared/lib/popup';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import { useManager } from '@cashu/coco-react';
import { attemptRollback } from '@/shared/lib/cashu/utils';
import { useRollbackStore } from '@/shared/stores/runtime/rollbackStore';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import {
  matchesTransactionFilters,
  type TransactionDirection,
  type TransactionPaymentType,
} from 'wallet';
import type {
  TransactionSourceFilter,
  TransactionLockFilter,
  TransactionCounterpartyFilter,
  TransactionZapFilter,
} from '../components/TransactionsFilterContext';

type StatusTab = 'All' | 'Confirmed' | 'Pending' | 'Expired';

const MONTH_SELECTOR_HEIGHT = 48;

// Small pages, coco-style: getPaginatedHistory is a cheap offset/limit read
// over an indexed SQLite projection, so the first paint needs only a
// screenful — onEndReached chains further pages as the user scrolls (and
// FlashList fires it immediately while content is shorter than the
// viewport, so the first screen self-fills).
const HISTORY_PAGE_SIZE = 10;

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

interface TransactionsScreenProps {
  initialTab?: StatusTab;
  /** Called when a transaction is tapped - used for flow-aware navigation */
  onTransactionPress?: (historyEntry: HistoryEntry) => void;
  /** External filter: currency (from filter flow) */
  filterCurrency?: string;
  /** External filter: payment type (from filter flow) */
  filterPaymentType?: TransactionPaymentType;
  /** External filter: direction (from filter flow) */
  filterDirection?: TransactionDirection;
  /** External filter: mint URL (from filter flow) */
  filterMintUrl?: string;
  /** External filter: source/transport (qr/nfc/ble/paste/deeplink) */
  filterSource?: TransactionSourceFilter;
  /** External filter: P2PK lock state */
  filterLock?: TransactionLockFilter;
  /** External filter: has a nostr counterparty */
  filterCounterparty?: TransactionCounterpartyFilter;
  /** External filter: paid for a nostr post (zap annotation) */
  filterZap?: TransactionZapFilter;
  /**
   * External month key (format: "YYYY-MM"). No longer a filter — it names the
   * month the viewport is on / should jump to.
   */
  filterMonth?: string | null;
  /** Callback when the active month changes (pill tap or scroll). */
  onMonthChange?: (month: string | null) => void;
}

export function TransactionsScreen({
  initialTab = 'All',
  onTransactionPress,
  filterCurrency,
  filterPaymentType = 'all',
  filterDirection = 'all',
  filterMintUrl = 'all',
  filterSource = 'all',
  filterLock = 'all',
  filterCounterparty = 'all',
  filterZap = 'all',
  filterMonth,
  onMonthChange,
}: TransactionsScreenProps) {
  useLifecycleLogger('TransactionsScreen');
  const manager = useManager();
  const { isOffline } = useOfflineStatus();

  const selectedCurrency = filterCurrency || 'sat';
  const paymentType = filterPaymentType;
  const direction = filterDirection;
  const tab = initialTab;

  const [internalMonth, setInternalMonth] = useState<string | null>(null);
  const selectedMonth = filterMonth !== undefined ? filterMonth : internalMonth;
  const handleMonthChange = onMonthChange || setInternalMonth;

  const [totalHeaderHeight, setTotalHeaderHeight] = useState(0);
  const transactionsRef = useRef<TransactionsHandle>(null);

  const [visiblePendingEcash, setVisiblePendingEcash] = useState<SendHistoryEntry[]>([]);
  const [isSweeping, setIsSweeping] = useState(false);

  const reclaimOne = useCallback(
    async (operationId: string): Promise<boolean> => {
      const { start, succeed, fail } = useRollbackStore.getState();
      start(operationId);
      const ok = await attemptRollback(manager, operationId);
      if (ok) succeed(operationId);
      else fail(operationId);
      return ok;
    },
    [manager]
  );

  const handleCancelOne = useCallback(
    async (entry: SendHistoryEntry) => {
      if (useRollbackStore.getState().inFlight.has(entry.operationId)) return;
      if (isOffline) {
        staticPopup('cancel-transaction-offline');
        return;
      }
      log.info('transactions.pending.cancel.one', {
        operationId: entry.operationId,
        ...mintUrlLogFields(entry.mintUrl),
      });
      await reclaimOne(entry.operationId);
    },
    [isOffline, reclaimOne]
  );

  const handleSweepVisible = useCallback(async () => {
    if (isSweeping || visiblePendingEcash.length === 0) return;
    if (isOffline) {
      staticPopup('cancel-transaction-offline');
      return;
    }
    log.info('transactions.pending.sweep.visible.start', {
      count: visiblePendingEcash.length,
    });
    setIsSweeping(true);

    const targets = [...visiblePendingEcash];
    let success = 0;
    let failed = 0;
    for (const tx of targets) {
      const ok = await reclaimOne(tx.operationId);
      if (ok) success++;
      else failed++;
    }

    setIsSweeping(false);
    log.info('transactions.pending.sweep.visible.complete', { success, failed });

    if (failed === 0) {
      paramPopup('rollback-success', { count: success });
    } else {
      paramPopup('rollback-partial', { success, failed, total: targets.length });
    }
  }, [isOffline, isSweeping, visiblePendingEcash, reclaimOne]);

  const totalVisiblePendingAmount = useMemo(
    () => visiblePendingEcash.reduce((sum, tx) => sum + amountToNumber(tx.amount), 0),
    [visiblePendingEcash]
  );
  const visibleUnit = visiblePendingEcash[0]?.unit || selectedCurrency;

  const { history, isFetching, loadMore, hasMore } = useHistoryWithMelts(HISTORY_PAGE_SIZE);

  // One list over all months means the whole history must be reachable by
  // scrolling: page in the next coco history batch as the end approaches.
  // Month pills grow as older pages land (they derive from rendered sections).
  //
  // FlashList fires onEndReached ONCE on entering the near-end zone and only
  // re-arms when `data` changes — so a request that lands mid-fetch must be
  // QUEUED, not dropped. Dropping it deadlocks the list: no load → no data
  // change → the trigger never fires again no matter how far the user
  // scrolls. With small pages the very first shot fires while the initial
  // fetch is still in flight, so this is the common path, not an edge case.
  const pendingLoadMoreRef = useRef(false);
  const handleEndReached = useCallback(() => {
    if (!hasMore) return;
    if (isFetching) {
      pendingLoadMoreRef.current = true;
      return;
    }
    log.info('transactions.history.load_more', { loaded: history.length });
    void loadMore();
  }, [hasMore, isFetching, loadMore, history.length]);

  // Drain a queued load once the in-flight fetch settles.
  useEffect(() => {
    if (isFetching || !pendingLoadMoreRef.current) return;
    pendingLoadMoreRef.current = false;
    if (!hasMore) return;
    log.info('transactions.history.load_more', { loaded: history.length, queued: true });
    void loadMore();
  }, [isFetching, hasMore, loadMore, history.length]);

  // No month in the key: the active month changes as the user scrolls, and a
  // remount on every month change would reset the scroll position it tracks.
  const listKey = `${paymentType}-${direction}-${tab}-${selectedCurrency}-${filterMintUrl}`;

  const filteredByTypeHistory = useMemo(() => {
    return history.filter((historyEntry) => {
      if (selectedCurrency !== 'all' && historyEntry.unit !== selectedCurrency) return false;
      if (!matchesTransactionFilters(historyEntry, { paymentType, direction })) return false;
      return true;
    });
  }, [history, selectedCurrency, paymentType, direction]);

  const parsedAccount = { unit: selectedCurrency };

  // The list is the single source of truth for months: it reports the months
  // actually present in its rendered sections (including swap-only months and
  // annotation-filter gaps), so the pills always match what is scrollable.
  const [months, setMonths] = useState<MonthItem[]>([]);

  // Keep the pill highlight valid: default to the newest month on first
  // paint, and re-home it when a filter change drops the current month.
  useEffect(() => {
    if (months.length === 0) return;
    if (!selectedMonth || !months.some((m) => m.key === selectedMonth)) {
      handleMonthChange(months[0].key);
    }
  }, [months, selectedMonth, handleMonthChange]);

  const handlePillSelect = useCallback(
    (key: string | null) => {
      handleMonthChange(key);
      if (key) transactionsRef.current?.scrollToMonth(key);
    },
    [handleMonthChange]
  );

  // A filter/tab change remounts the FlashList (new `listKey`) at the top;
  // jump back to the already-selected month so the viewport lands where the
  // pill says it is. Mirrors the old pager's `initialPage` behavior — the
  // sentinel start value also covers re-entering the screen with a month
  // still selected in the flow context.
  const lastListKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastListKeyRef.current === listKey) return;
    lastListKeyRef.current = listKey;
    if (selectedMonth) transactionsRef.current?.scrollToMonth(selectedMonth);
  }, [listKey, selectedMonth]);

  // Manual scrolling drives the pill highlight via the topmost visible section.
  const handleVisibleMonthChange = useCallback(
    (monthKey: string) => {
      handleMonthChange(monthKey);
    },
    [handleMonthChange]
  );

  const monthSelectorContent = useMemo(
    () => (
      <MonthSelector
        months={months}
        selectedMonth={selectedMonth}
        onMonthChange={handlePillSelect}
      />
    ),
    [months, selectedMonth, handlePillSelect]
  );

  // Reserves the full header height; the wrapper derives it from a frame-0-stable
  // value on iOS, so this spacer no longer reflows on a late header settle.
  const listHeader = useMemo(
    () => <View style={{ height: totalHeaderHeight }} />,
    [totalHeaderHeight]
  );

  // Footer: cancel-all button. Only on the Pending tab — surfacing a sweep
  // action while the user browses 'All' (mostly historical) mixes intents.
  // Since the list spans all months, the sweep covers every cancellable
  // pending send in the list, not just the month currently on screen; the
  // button label carries the exact count and amount.
  const showSweepFooter = tab === 'Pending' && visiblePendingEcash.length > 0;

  const sweepFooter = useMemo(() => {
    if (!showSweepFooter) return undefined;
    return (
      <BottomButtons>
        <ButtonHandler
          buttons={[
            {
              text: isSweeping
                ? 'Cancelling...'
                : `Cancel ${visiblePendingEcash.length} pending (${totalVisiblePendingAmount} ${visibleUnit.toUpperCase()})`,
              variant: 'primary',
              icon: 'mdi:broom',
              loading: isSweeping,
              disabled: isSweeping,
              onPress: handleSweepVisible,
            },
          ]}
        />
      </BottomButtons>
    );
  }, [
    showSweepFooter,
    isSweeping,
    visiblePendingEcash.length,
    totalVisiblePendingAmount,
    visibleUnit,
    handleSweepVisible,
  ]);

  return (
    <Screen
      name="TransactionsScreen"
      headerGradient
      stickyContent={monthSelectorContent}
      stickyContentHeight={MONTH_SELECTOR_HEIGHT}
      scroll="custom"
      footer={sweepFooter}
      onHeaderHeightChange={setTotalHeaderHeight}>
      <Transactions
        ref={transactionsRef}
        listKey={listKey}
        account={{ ...parsedAccount, unit: selectedCurrency }}
        showMore={false}
        history={filteredByTypeHistory}
        isFetching={isFetching}
        filter={direction}
        type={paymentType}
        mintUrlFilter={filterMintUrl}
        source={filterSource}
        lock={filterLock}
        counterparty={filterCounterparty}
        zap={filterZap}
        at="all"
        tab={tab}
        onTransactionPress={onTransactionPress}
        onCancelPendingEcash={handleCancelOne}
        onVisiblePendingEcashChange={setVisiblePendingEcash}
        onMonthsChange={setMonths}
        onVisibleMonthChange={handleVisibleMonthChange}
        onEndReached={handleEndReached}
        header={listHeader}
        disableContentInsetAdjustment
      />
    </Screen>
  );
}
