import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HistoryEntry, Manager } from "@cashu/coco-core";

import { logger } from "../logger";
import {
  listInFlightReceiveEntries,
  mergeTransactionSources,
  sameTransactionList,
} from "../history/aggregate";
import { normalizeHistoryEntries } from "../history/normalize";
import {
  candidateKeys,
  mergeAnnotationRecords,
  mergeAnnotationsIntoEntry,
} from "../annotations";
import { useAnnotationStore, useColadaManager } from "./ColadaProvider";

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

function sameMetadata(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * Like `sameTransactionList` but also compares merged metadata, so an annotation
 * change (which mutates content without changing id/state) re-renders the row
 * while un-annotated rows keep their reference.
 */
function sameAnnotatedList(
  a: readonly HistoryEntry[],
  b: readonly HistoryEntry[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      (x as { state?: unknown }).state !== (y as { state?: unknown }).state ||
      !sameMetadata(
        (x as { metadata?: Record<string, string> }).metadata,
        (y as { metadata?: Record<string, string> }).metadata,
      )
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The canonical wallet transaction list. Wraps coco's paginated history and
 * supplements it with melt operations and received-but-unredeemed (executing)
 * ecash that coco does not project into history, deduped and classified-ready,
 * then merges per-transaction annotations into each entry's metadata.
 *
 * React binding over the framework-agnostic aggregation in `history/aggregate`.
 * Consumers bucket entries with `bucketTransaction`.
 */
export function useColadaTransactions(
  pageSize = 100,
): UseColadaTransactionsResult {
  const manager = useColadaManager();
  const annotationStore = useAnnotationStore();

  const [cocoHistory, setCocoHistory] = useState<HistoryEntry[]>([]);
  const [receiveEntries, setReceiveEntries] = useState<HistoryEntry[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  // Bumped whenever the annotation store changes so the merged list recomputes.
  const [annotationVersion, setAnnotationVersion] = useState(0);

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
        // Normalize v2 operation-projected states to the legacy vocabulary
        // once, at the read-model boundary.
        return normalizeHistoryEntries(
          (await managerRef.current.history.getPaginatedHistory(
            offset,
            pageSize,
          )) ?? [],
        );
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
      const receives = await listInFlightReceiveEntries(managerRef.current);
      if (!mountedRef.current) return;
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

  // Annotation store changes -> recompute the merged list (new metadata only).
  useEffect(() => {
    const unsubscribe = annotationStore.subscribe(() =>
      setAnnotationVersion((v) => v + 1),
    );
    return unsubscribe;
  }, [annotationStore]);

  // coco history changes (mint/melt/send/receive projected) -> refresh page 0.
  useEffect(() => {
    const onHistory = () => void refreshRef.current();
    manager.on("history:updated", onHistory);
    return () => manager.off("history:updated", onHistory);
  }, [manager]);

  // Melt operation lifecycle -> refresh page 0 (v2 projects melts into
  // history directly; there is no melt supplement anymore).
  useEffect(() => {
    const onMelt = () => void refreshRef.current();
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
  }, [manager]);

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
  const baseHistory = useMemo(() => {
    const merged = mergeTransactionSources({
      cocoHistory,
      receiveEntries,
    });
    if (sameTransactionList(prevMergedRef.current, merged)) {
      return prevMergedRef.current;
    }
    prevMergedRef.current = merged;
    return merged;
  }, [cocoHistory, receiveEntries]);

  // Merge per-transaction annotations into each entry's metadata. Un-annotated
  // rows keep their reference (mergeAnnotationsIntoEntry is identity on empty),
  // and the metadata-aware gate keeps the list stable across renders unless an
  // annotation actually changed.
  const prevAnnotatedRef = useRef<HistoryEntry[]>([]);
  const history = useMemo(() => {
    const annotated = baseHistory.map((entry) =>
      mergeAnnotationsIntoEntry(
        entry,
        mergeAnnotationRecords(annotationStore.getMany(candidateKeys(entry))),
      ),
    );
    if (sameAnnotatedList(prevAnnotatedRef.current, annotated)) {
      return prevAnnotatedRef.current;
    }
    prevAnnotatedRef.current = annotated;
    return annotated;
    // annotationVersion drives recompute when the store mutates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseHistory, annotationStore, annotationVersion]);

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
