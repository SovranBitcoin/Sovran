import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  HistoryEntry,
  Manager,
  MeltHistoryEntry,
} from "@cashu/coco-core";

import { logger } from "../logger";
import {
  listInFlightReceiveEntries,
  listMeltSupplementEntries,
  mergeTransactionSources,
  sameTransactionList,
} from "../history/aggregate";
import { useColadaManager } from "./ColadaProvider";

export interface UseColadaTransactionsResult {
  /** Merged, deduped, newest-first transaction history. */
  history: HistoryEntry[];
  /** Load the next page of coco history (infinite scroll). */
  loadMore: () => Promise<void>;
  /** Jump to a specific page of coco history. */
  goToPage: (page: number) => Promise<void>;
  /** Re-fetch the first page + supplements. */
  refresh: () => Promise<void>;
  /** Whether more coco history pages exist. */
  hasMore: boolean;
  /** Whether a fetch is in flight. */
  isFetching: boolean;
}

/**
 * The canonical wallet transaction list. Wraps coco's paginated history and
 * supplements it with melt operations and received-but-unredeemed (executing)
 * ecash that coco does not project into history, deduped and classified-ready.
 *
 * React binding over the framework-agnostic aggregation in `history/aggregate`.
 * Consumers bucket entries with `bucketTransaction`.
 */
export function useColadaTransactions(pageSize = 100): UseColadaTransactionsResult {
  const manager = useColadaManager();

  const [cocoHistory, setCocoHistory] = useState<HistoryEntry[]>([]);
  const [meltEntries, setMeltEntries] = useState<MeltHistoryEntry[]>([]);
  const [receiveEntries, setReceiveEntries] = useState<HistoryEntry[]>([]);
  const [isFetching, setIsFetching] = useState(false);

  // coco pagination state — mirrors @cashu/coco-react usePaginatedHistory.
  const offsetRef = useRef(0);
  const hasMoreRef = useRef(true);
  const modeRef = useRef<"infinite" | "page">("infinite");
  const mountedRef = useRef(true);
  const fetchingRef = useRef(false);
  const managerRef = useRef<Manager>(manager);
  managerRef.current = manager;

  const setFetching = useCallback((value: boolean) => {
    fetchingRef.current = value;
    setIsFetching(value);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchPage = useCallback(
    async (offset: number): Promise<HistoryEntry[]> => {
      try {
        return (await managerRef.current.history.getPaginatedHistory(offset, pageSize)) ?? [];
      } catch (err) {
        logger.warn("history.transactions.page_failed", {
          offset,
          error: err instanceof Error ? err.message : String(err),
        });
        return [];
      }
    },
    [pageSize],
  );

  const fetchSupplements = useCallback(async () => {
    try {
      const [melts, receives] = await Promise.all([
        listMeltSupplementEntries(managerRef.current),
        listInFlightReceiveEntries(managerRef.current),
      ]);
      if (!mountedRef.current) return;
      setMeltEntries(melts);
      setReceiveEntries(receives);
    } catch (err) {
      logger.warn("history.transactions.supplements_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const refresh = useCallback(async () => {
    if (fetchingRef.current) return;
    setFetching(true);
    try {
      if (modeRef.current === "infinite" && offsetRef.current === 0) {
        const page = await fetchPage(0);
        if (mountedRef.current) {
          setCocoHistory((prev) => {
            const fresh = prev.filter((p) => !page.some((n) => n.id === p.id));
            return [...page, ...fresh];
          });
        }
      } else {
        const page = await fetchPage(offsetRef.current);
        if (mountedRef.current) setCocoHistory(page);
      }
      await fetchSupplements();
    } finally {
      setFetching(false);
    }
  }, [fetchPage, fetchSupplements, setFetching]);

  // Keep a stable ref to refresh for event handlers.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // Initial load + reload when the manager identity changes (profile switch).
  useEffect(() => {
    let cancelled = false;
    setFetching(true);
    modeRef.current = "infinite";
    offsetRef.current = 0;
    (async () => {
      const page = await fetchPage(0);
      hasMoreRef.current = page.length === pageSize;
      if (!cancelled && mountedRef.current) setCocoHistory(page);
      await fetchSupplements();
      if (!cancelled) setFetching(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [manager, pageSize, fetchPage, fetchSupplements, setFetching]);

  // coco history changes (mint/melt/send/receive projected) -> refresh page 0.
  useEffect(() => {
    const onHistory = () => void refreshRef.current();
    manager.on("history:updated", onHistory);
    return () => manager.off("history:updated", onHistory);
  }, [manager]);

  // Melt operation lifecycle -> re-fetch the melt supplement.
  useEffect(() => {
    const onMelt = () => void fetchSupplements();
    manager.on("melt-op:prepared", onMelt);
    manager.on("melt-op:pending", onMelt);
    manager.on("melt-op:finalized", onMelt);
    manager.on("melt-op:rolled-back", onMelt);
    return () => {
      manager.off("melt-op:prepared", onMelt);
      manager.off("melt-op:pending", onMelt);
      manager.off("melt-op:finalized", onMelt);
      manager.off("melt-op:rolled-back", onMelt);
    };
  }, [manager, fetchSupplements]);

  // Receive operation lifecycle -> re-fetch the in-flight receive supplement.
  useEffect(() => {
    const onReceive = () => void fetchSupplements();
    manager.on("receive-op:prepared", onReceive);
    manager.on("receive-op:finalized", onReceive);
    manager.on("receive-op:rolled-back", onReceive);
    manager.on("proofs:saved", onReceive);
    return () => {
      manager.off("receive-op:prepared", onReceive);
      manager.off("receive-op:finalized", onReceive);
      manager.off("receive-op:rolled-back", onReceive);
      manager.off("proofs:saved", onReceive);
    };
  }, [manager, fetchSupplements]);

  const loadMore = useCallback(async () => {
    if (!hasMoreRef.current || fetchingRef.current) return;
    setFetching(true);
    modeRef.current = "infinite";
    try {
      const nextOffset = offsetRef.current + pageSize;
      const page = await fetchPage(nextOffset);
      hasMoreRef.current = page.length === pageSize;
      if (mountedRef.current) {
        setCocoHistory((prev) => {
          const seen = new Set<string>();
          const out: HistoryEntry[] = [];
          for (const entry of [...prev, ...page]) {
            if (seen.has(entry.id)) continue;
            seen.add(entry.id);
            out.push(entry);
          }
          return out;
        });
        offsetRef.current = nextOffset;
      }
    } finally {
      setFetching(false);
    }
  }, [fetchPage, pageSize, setFetching]);

  const goToPage = useCallback(
    async (page: number) => {
      if (fetchingRef.current) return;
      setFetching(true);
      modeRef.current = "page";
      try {
        const offset = page * pageSize;
        const result = await fetchPage(offset);
        hasMoreRef.current = result.length === pageSize;
        if (mountedRef.current) {
          setCocoHistory(result);
          offsetRef.current = offset;
        }
      } finally {
        setFetching(false);
      }
    },
    [fetchPage, pageSize, setFetching],
  );

  // Merge sources; keep a stable reference when the display-relevant content
  // (id + state per row) is unchanged so consumers don't re-render needlessly.
  const prevMergedRef = useRef<HistoryEntry[]>([]);
  const history = useMemo(() => {
    const merged = mergeTransactionSources({
      cocoHistory,
      meltEntries,
      receiveEntries,
    });
    if (sameTransactionList(prevMergedRef.current, merged)) {
      return prevMergedRef.current;
    }
    prevMergedRef.current = merged;
    return merged;
  }, [cocoHistory, meltEntries, receiveEntries]);

  return useMemo(
    () => ({
      history,
      loadMore,
      goToPage,
      refresh,
      hasMore: hasMoreRef.current,
      isFetching,
    }),
    [history, loadMore, goToPage, refresh, isFetching],
  );
}
