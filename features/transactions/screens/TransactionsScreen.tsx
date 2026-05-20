/**
 * @fileoverview Shared Transactions screen component
 *
 * This module provides the core UI and logic for the transactions list.
 * It is used by both standalone and flow-based route wrappers.
 *
 * Features:
 * - Native Stack header handles title and buttons
 * - Sticky month selector with blur/gradient below header (via Screen)
 * - Virtualized transaction list
 * - Filter support via external props (from filter flow)
 * - Inline pending-ecash sweep: when tab=Pending and the visible bucket has
 *   cancellable ecash sends, surfaces a "Cancel N pending" footer that
 *   reclaims every visible row, plus per-row swipe-to-cancel.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PagerView from 'react-native-pager-view';
import { View } from '@/shared/ui/primitives/View/View';
import { Transactions } from '@/features/transactions/components/Transactions';
import {
  MonthSelector,
  extractMonthsFromHistory,
} from '@/features/transactions/components/MonthSelector';
import { HistoryEntry, SendHistoryEntry } from '@cashu/coco-core';
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

type StatusTab = 'All' | 'Confirmed' | 'Pending' | 'Expired';
type PaymentType = 'all' | 'lightning' | 'ecash';
type Direction = 'all' | 'incoming' | 'outgoing';

const MONTH_SELECTOR_HEIGHT = 48;

interface TransactionsScreenProps {
  initialTab?: StatusTab;
  /** Called when a transaction is tapped - used for flow-aware navigation */
  onTransactionPress?: (historyEntry: HistoryEntry) => void;
  /** External filter: currency (from filter flow) */
  filterCurrency?: string;
  /** External filter: payment type (from filter flow) */
  filterPaymentType?: PaymentType;
  /** External filter: direction (from filter flow) */
  filterDirection?: Direction;
  /** External filter: mint URL (from filter flow) */
  filterMintUrl?: string;
  /** External filter: selected month key (format: "YYYY-MM") */
  filterMonth?: string | null;
  /** Callback when month selection changes */
  onMonthChange?: (month: string | null) => void;
}

export function TransactionsScreen({
  initialTab = 'All',
  onTransactionPress,
  filterCurrency,
  filterPaymentType = 'all',
  filterDirection = 'all',
  filterMintUrl = 'all',
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
  const pagerRef = useRef<PagerView>(null);

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
        mintUrl: entry.mintUrl,
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
    () => visiblePendingEcash.reduce((sum, tx) => sum + tx.amount, 0),
    [visiblePendingEcash]
  );
  const visibleUnit = visiblePendingEcash[0]?.unit || selectedCurrency;

  const getCocoTransactionTypes = useCallback((): HistoryEntry['type'][] => {
    if (paymentType === 'all' && direction === 'all') {
      return ['mint', 'melt', 'send', 'receive'];
    }

    if (paymentType === 'lightning') {
      if (direction === 'all') return ['mint', 'melt'];
      if (direction === 'incoming') return ['mint'];
      if (direction === 'outgoing') return ['melt'];
    }

    if (paymentType === 'ecash') {
      if (direction === 'all') return ['send', 'receive'];
      if (direction === 'incoming') return ['receive'];
      if (direction === 'outgoing') return ['send'];
    }

    if (paymentType === 'all') {
      if (direction === 'incoming') return ['mint', 'receive'];
      if (direction === 'outgoing') return ['melt', 'send'];
    }

    return [];
  }, [paymentType, direction]);

  const { history, isFetching } = useHistoryWithMelts();

  const listKey = `${paymentType}-${direction}-${tab}-${selectedCurrency}-${filterMintUrl}-${selectedMonth}`;

  const filteredByTypeHistory = useMemo(() => {
    const allowedTypes = getCocoTransactionTypes();

    return history.filter((historyEntry) => {
      if (historyEntry.unit !== selectedCurrency) return false;
      if (allowedTypes.length > 0 && !allowedTypes.includes(historyEntry.type)) return false;
      return true;
    });
  }, [history, selectedCurrency, getCocoTransactionTypes]);

  const parsedAccount = { unit: selectedCurrency };

  // Pager pages and the month-pill row need to share the same months array so
  // the active index always lines up with the active page.
  const months = useMemo(
    () => extractMonthsFromHistory(filteredByTypeHistory),
    [filteredByTypeHistory]
  );

  // Default to the newest month once the months list is known. Owning this
  // here (instead of inside MonthSelector) lets the pager's `initialPage`
  // line up with the selected pill on first paint, no flicker.
  useEffect(() => {
    if (selectedMonth === null && months.length > 0) {
      handleMonthChange(months[0].key);
    }
  }, [months, selectedMonth, handleMonthChange]);

  const activeIndex = useMemo(() => {
    if (!selectedMonth || months.length === 0) return 0;
    const idx = months.findIndex((m) => m.key === selectedMonth);
    return idx >= 0 ? idx : 0;
  }, [months, selectedMonth]);

  // If a filter change drops the current month out of `months`, snap the
  // pager and pill row back to the first available month. Mirrors the
  // BackgroundScreen pattern.
  useEffect(() => {
    if (months.length === 0) return;
    if (selectedMonth && !months.some((m) => m.key === selectedMonth)) {
      handleMonthChange(months[0].key);
      pagerRef.current?.setPageWithoutAnimation(0);
    }
  }, [months, selectedMonth, handleMonthChange]);

  const handlePillSelect = useCallback(
    (key: string | null) => {
      handleMonthChange(key);
      if (!key) return;
      const idx = months.findIndex((m) => m.key === key);
      if (idx >= 0) pagerRef.current?.setPage(idx);
    },
    [handleMonthChange, months]
  );

  const handlePageSelected = useCallback(
    (event: { nativeEvent: { position: number } }) => {
      const idx = event.nativeEvent.position;
      const next = months[idx];
      if (next) handleMonthChange(next.key);
    },
    [months, handleMonthChange]
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

  const listHeader = useMemo(
    () => <View style={{ height: totalHeaderHeight }} />,
    [totalHeaderHeight]
  );

  // Footer: cancel-all-visible button. Only on the Pending tab — surfacing
  // a sweep action while the user browses 'All' (mostly historical) mixes
  // intents.
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
      {months.length > 0 ? (
        <PagerView
          ref={pagerRef}
          style={{ flex: 1 }}
          initialPage={activeIndex}
          onPageSelected={handlePageSelected}
          overdrag>
          {months.map((month, idx) => (
            <View key={month.key} className="flex-1">
              <Transactions
                listKey={`${listKey}-${month.key}`}
                account={{ ...parsedAccount, unit: selectedCurrency }}
                showMore={false}
                history={filteredByTypeHistory}
                isFetching={isFetching}
                filter={direction}
                type={paymentType}
                mintUrlFilter={filterMintUrl}
                at="all"
                tab={tab}
                selectedMonth={month.key}
                onTransactionPress={onTransactionPress}
                onCancelPendingEcash={handleCancelOne}
                // Only the active page reports its visible pending ecash so
                // the sweep footer reflects what the user is currently
                // looking at, not what other off-screen pages contain.
                onVisiblePendingEcashChange={
                  idx === activeIndex ? setVisiblePendingEcash : undefined
                }
                header={listHeader}
                disableContentInsetAdjustment
              />
            </View>
          ))}
        </PagerView>
      ) : (
        <Transactions
          listKey={listKey}
          account={{ ...parsedAccount, unit: selectedCurrency }}
          showMore={false}
          history={filteredByTypeHistory}
          isFetching={isFetching}
          filter={direction}
          type={paymentType}
          mintUrlFilter={filterMintUrl}
          at="all"
          tab={tab}
          selectedMonth={selectedMonth}
          onTransactionPress={onTransactionPress}
          onCancelPendingEcash={handleCancelOne}
          onVisiblePendingEcashChange={setVisiblePendingEcash}
          header={listHeader}
          disableContentInsetAdjustment
        />
      )}
    </Screen>
  );
}
