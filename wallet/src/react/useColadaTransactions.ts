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
/** Compact, redaction-safe order summary for render diagnostics. */
function summarizeEntries(
  entries: readonly HistoryEntry[],
): Record<string, unknown> {
  return {
    total: entries.length,
    head: entries
      .slice(0, 12)
      .map(
        (e) => `${e.type}@${new Date(e.createdAt).toISOString().slice(0, 10)}`,
      )
      .join(","),
    headTs: entries[0]?.createdAt ?? null,
    tailTs: entries[entries.length - 1]?.createdAt ?? null,
    sortedDesc: entries.every(
      (e, i) => i === 0 || entries[i - 1].createdAt >= e.createdAt,
    ),
  };
}

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
  // Which code path produced the current cocoHistory — stamped right before
  // each setCocoHistory, logged once per committed change below.
  const historyReasonRef = useRef("init");
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

  // Render-order diagnostics: one line per committed list change, tagged
  // with the path that produced it.
  useEffect(() => {
    logger.info("history.state.applied", {
      reason: historyReasonRef.current,
      mode: modeRef.current,
      offset: offsetRef.current,
      ...summarizeEntries(cocoHistory),
    });
  }, [cocoHistory]);

  const fetchPage = useCallback(
    async (offset: number): Promise<HistoryEntry[]> => {
      try {
        const raw =
          (await managerRef.current.history.getPaginatedHistory(
            offset,
            pageSize,
          )) ?? [];
        // Upstream-feedback tripwire: coco's projection promises unique
        // deterministic ids per page; duplicates would mean double-projected
        // operations (the class the deleted melt supplement used to cause).
        const ids = new Set<string>();
        let duplicateIds = 0;
        for (const entry of raw) {
          if (ids.has(entry.id)) duplicateIds++;
          else ids.add(entry.id);
        }
        if (duplicateIds > 0) {
          logger.warn("history.projection.duplicate_ids", {
            offset,
            pageSize,
            duplicateIds,
          });
        }
        // Normalize v2 operation-projected states to the legacy vocabulary
        // once, at the read-model boundary.
        const normalized = normalizeHistoryEntries(raw);
        // Render-order diagnostics: exactly what coco returned for this
        // window, in coco's order. Dates only — no amounts, mints, tokens.
        logger.info("history.page.fetched", {
          offset,
          count: normalized.length,
          first: normalized[0]
            ? `${normalized[0].type}@${new Date(normalized[0].createdAt).toISOString()}`
            : null,
          last: normalized[normalized.length - 1]
            ? `${normalized[normalized.length - 1].type}@${new Date(
                normalized[normalized.length - 1].createdAt,
              ).toISOString()}`
            : null,
          sortedDesc: normalized.every(
            (e, i) => i === 0 || normalized[i - 1].createdAt >= e.createdAt,
          ),
        });
        return normalized;
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
      if (modeRef.current === "infinite") {
        // Merge a fresh page 0 onto the head at ANY scroll depth. This
        // deliberately diverges from coco-react's usePaginatedHistory, which
        // only head-merges at offset 0 and otherwise REPLACES the whole
        // accumulated list with the single window at the current offset —
        // after loadMore, a history:updated event (any new transaction)
        // would drop every newer page and jump the list to old history.
        // Upstream-feedback case; report against coco-react.
        const page = await fetchPage(0);
        if (mountedRef.current) {
          historyReasonRef.current = "refresh-head";
          setCocoHistory((prev) => {
            const pageIds = new Set(page.map((n) => n.id));
            const fresh = prev.filter((p) => !pageIds.has(p.id));
            return [...page, ...fresh];
          });
        }
      } else {
        const page = await fetchPage(offsetRef.current);
        if (mountedRef.current) {
          historyReasonRef.current = "refresh-window";
          setCocoHistory(page);
        }
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
      if (!cancelled && mountedRef.current) {
        historyReasonRef.current = "initial";
        setCocoHistory(page);
      }
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
        historyReasonRef.current = "loadMore";
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
          historyReasonRef.current = "goToPage";
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
