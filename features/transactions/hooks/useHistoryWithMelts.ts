import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useManager, usePaginatedHistory } from 'coco-cashu-react';
import type { MeltHistoryEntry, HistoryEntry } from 'coco-cashu-core';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useMockDataStore } from '@/shared/stores/runtime/mockDataStore';

/**
 * Shape of a MeltOperation from coco's MeltOperationRepository.
 * We only declare the fields we need for conversion.
 */
interface MeltOp {
  id: string;
  mintUrl: string;
  createdAt: number;
  state: string;
  quoteId?: string;
  amount?: number;
}

/**
 * Unsafe accessor for the private meltOperationRepository on the Manager.
 * This is the same pattern used elsewhere in the codebase (e.g. cancelMeltQuote
 * accesses meltOperationService).
 */
interface UnsafeRepo {
  getByState?: (state: string) => Promise<MeltOp[]>;
}

function opStateToQuoteState(opState: string): 'PAID' | 'PENDING' | 'UNPAID' {
  if (opState === 'finalized') return 'PAID';
  if (opState === 'pending' || opState === 'executing') return 'PENDING';
  return 'UNPAID';
}

function meltOpToHistoryEntry(op: MeltOp): MeltHistoryEntry | null {
  if (!op.quoteId || op.amount == null) return null;
  return {
    id: op.id,
    type: 'melt',
    createdAt: op.createdAt,
    mintUrl: op.mintUrl,
    unit: 'sat',
    quoteId: op.quoteId,
    state: opStateToQuoteState(op.state),
    amount: op.amount,
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
      const repo = (manager as unknown as { meltOperationRepository?: UnsafeRepo })
        .meltOperationRepository;
      if (!repo?.getByState) return;

      const [finalized, pending, prepared] = await Promise.all([
        repo.getByState('finalized'),
        repo.getByState('pending'),
        repo.getByState('prepared'),
      ]);

      const entries = [...finalized, ...pending, ...prepared]
        .map(meltOpToHistoryEntry)
        .filter((e): e is MeltHistoryEntry => e !== null);

      if (isMountedRef.current) {
        setMeltEntries(entries);
      }
    } catch {
      // Repository may not be accessible — fall back to history-only
    }
  }, [manager]);

  // Initial fetch
  useEffect(() => {
    fetchMeltOps();
  }, [fetchMeltOps]);

  // Re-fetch when melt-op events fire so the list stays in sync
  useEffect(() => {
    const handler = () => {
      void fetchMeltOps();
    };
    const unsubs = [
      manager.on('melt-op:prepared', handler),
      manager.on('melt-op:finalized', handler),
      manager.on('melt-op:pending', handler),
      manager.on('melt-op:rolled-back', handler),
    ];
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [manager, fetchMeltOps]);

  // Merge melt operations into history, deduplicating by quoteId
  const mergedHistory = useMemo(() => {
    // Collect quoteIds already present in the regular history
    const existingQuoteIds = new Set<string>();
    for (const h of paginatedResult.history) {
      if (h.type === 'melt') {
        const quoteId = (h as MeltHistoryEntry).quoteId;
        if (quoteId) existingQuoteIds.add(quoteId);
      }
    }

    const newMelts = meltEntries.filter((m) => !existingQuoteIds.has(m.quoteId));
    if (newMelts.length === 0) return paginatedResult.history;

    return [...paginatedResult.history, ...newMelts].sort((a, b) => b.createdAt - a.createdAt);
  }, [paginatedResult.history, meltEntries]);

  // Wrap refresh to also re-fetch melt operations
  const refresh = useCallback(async () => {
    await Promise.all([paginatedResult.refresh(), fetchMeltOps()]);
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
