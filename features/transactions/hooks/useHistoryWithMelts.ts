import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useManager, usePaginatedHistory } from '@cashu/coco-react';
import { useColadaSubscriptions } from '@sovranbitcoin/colada/react';
import { MeltQuoteState } from '@cashu/cashu-ts';
import type {
  HistoryEntry,
  MeltHistoryEntry,
  MeltOperation,
  MeltOperationState,
} from '@cashu/coco-core';
import { listMeltOperationsByState } from '@/shared/lib/cashu/managerInternals';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useMockDataStore } from '@/shared/stores/runtime/mockDataStore';
import { log } from '@/shared/lib/logger';

function opStateToHistoryState(opState: MeltOperationState): MeltHistoryEntry['state'] {
  if (opState === 'finalized') return MeltQuoteState.PAID;
  if (opState === 'pending' || opState === 'executing') return MeltQuoteState.PENDING;
  return MeltQuoteState.UNPAID;
}

// MeltOperation is a discriminated union by state — only some variants carry
// `quoteId` and `amount`. Read both as optional and bail out if missing.
function meltOpToHistoryEntry(op: MeltOperation): MeltHistoryEntry | null {
  const opAny = op as Pick<MeltHistoryEntry, 'quoteId' | 'amount'>;
  if (!opAny.quoteId || opAny.amount == null) return null;
  return {
    id: op.id,
    type: 'melt',
    operationId: op.id,
    createdAt: op.createdAt,
    mintUrl: op.mintUrl,
    unit: 'sat',
    quoteId: opAny.quoteId,
    state: opStateToHistoryState(op.state),
    amount: opAny.amount,
  };
}

/**
 * Wraps `usePaginatedHistory` and supplements it with melt operations
 * fetched directly from coco's `MeltOperationRepository`.
 *
 * The v3 melt flow (`prepareMeltBolt11` / `executeMelt`) stores operations
 * in the MeltOperationRepository but does NOT create entries in the
 * HistoryRepository (the `melt-quote:created` event is never emitted).
 * This hook bridges the gap by querying the operation repository for
 * finalized, pending, and prepared melts, converting them to
 * `MeltHistoryEntry` objects, and merging them into the history array.
 *
 * Rolled-back melts are intentionally excluded.
 */
export function useHistoryWithMelts(pageSize = 100) {
  const paginatedResult = usePaginatedHistory(pageSize);
  const manager = useManager();
  const bus = useColadaSubscriptions();
  const mockMode = useSettingsStore((s) => s.mockMode);
  const mockHistory = useMockDataStore((s) => s.mockHistory);
  const [meltEntries, setMeltEntries] = useState<MeltHistoryEntry[]>([]);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchMeltOps = useCallback(async () => {
    try {
      log.debug('tx.melt_ops.fetch.start');
      const [finalized, pending, prepared] = await Promise.all([
        listMeltOperationsByState(manager, 'finalized'),
        listMeltOperationsByState(manager, 'pending'),
        listMeltOperationsByState(manager, 'prepared'),
      ]);

      const operations = [...finalized, ...pending, ...prepared];
      const entries = operations
        .map(meltOpToHistoryEntry)
        .filter((e): e is MeltHistoryEntry => e !== null);

      log.debug('tx.melt_ops.fetched', {
        finalized: finalized.length,
        pending: pending.length,
        prepared: prepared.length,
        rawCount: operations.length,
        converted: entries.length,
        skipped: operations.length - entries.length,
      });

      if (isMountedRef.current) {
        setMeltEntries(entries);
      } else {
        log.debug('tx.melt_ops.fetch.stale_result');
      }
    } catch (err) {
      log.warn('tx.melt_ops.fetch_error', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
      // Repository may not be accessible — fall back to history-only
    }
  }, [manager]);

  // Initial fetch
  useEffect(() => {
    void fetchMeltOps();
  }, [fetchMeltOps]);

  // Re-fetch when melt operation events reach Colada's bus so the list stays in sync.
  useEffect(() => {
    const handler = () => {
      log.debug('tx.melt_ops.event', { type: 'melt.updated' });
      void fetchMeltOps();
    };
    log.debug('tx.melt_ops.subscribe', { type: 'melt.updated' });
    return bus.subscribe({ type: 'melt.updated' }, handler);
  }, [bus, fetchMeltOps]);

  // Re-fetch history when any transaction state changes (pending → confirmed, etc.)
  useEffect(() => {
    return bus.subscribe({ type: 'history.updated' }, () => {
      log.debug('tx.history.event', { type: 'history.updated' });
      void paginatedResult.refresh();
    });
  }, [bus, paginatedResult.refresh]);

  // Merge melt operations into history, deduplicating by quoteId.
  // Stabilise: only return a new array ref if entries actually changed.
  const prevMergedRef = useRef<HistoryEntry[]>([]);
  const mergedHistory = useMemo(() => {
    const existingQuoteIds = new Set<string>();
    for (const h of paginatedResult.history) {
      if (h.type === 'melt') {
        const quoteId = (h as MeltHistoryEntry).quoteId;
        if (quoteId) existingQuoteIds.add(quoteId);
      }
    }

    const newMelts = meltEntries.filter((m) => !existingQuoteIds.has(m.quoteId));
    const merged =
      newMelts.length === 0
        ? paginatedResult.history
        : [...paginatedResult.history, ...newMelts].sort((a, b) => b.createdAt - a.createdAt);

    if (newMelts.length > 0) {
      log.debug('tx.history.merged', {
        paginatedCount: paginatedResult.history.length,
        supplementedMelts: newMelts.length,
        totalCount: merged.length,
      });
    }

    // Reference stability: only return a new ref if entry contents that affect
    // rendering have actually changed. Compare id + state pairwise — `state`
    // is the only field that mutates after entry creation (UNPAID → PAID,
    // prepared → pending → finalized, etc.) and is exactly what `<Transactions>`
    // groups on (Transactions.tsx:258-261). The previous version compared only
    // length + first/last id, so a mint quote transitioning UNPAID → PAID
    // returned the stale `prev` ref and the home screen kept rendering it as
    // pending until the component remounted (e.g. via "View all").
    const prev = prevMergedRef.current;
    let identical = prev.length === merged.length;
    if (identical) {
      for (let i = 0; i < prev.length; i++) {
        const p = prev[i];
        const m = merged[i];
        if (p.id !== m.id || (p as { state?: string }).state !== (m as { state?: string }).state) {
          identical = false;
          break;
        }
      }
    }
    if (identical) return prev;
    prevMergedRef.current = merged;
    return merged;
  }, [paginatedResult.history, meltEntries]);

  // Wrap refresh to also re-fetch melt operations
  const refresh = useCallback(async () => {
    log.debug('tx.history.refresh.start');
    try {
      await Promise.all([paginatedResult.refresh(), fetchMeltOps()]);
      log.debug('tx.history.refresh.done');
    } catch (err) {
      log.warn('tx.history.refresh.failed', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
      throw err;
    }
  }, [paginatedResult.refresh, fetchMeltOps]);

  // When mock mode is active, replace the real history with mock data
  const finalHistory = useMemo(
    () => (mockMode ? mockHistory : mergedHistory),
    [mockMode, mockHistory, mergedHistory]
  );

  return useMemo(
    () => ({
      ...paginatedResult,
      history: finalHistory,
      refresh,
    }),
    [paginatedResult, finalHistory, refresh]
  );
}
