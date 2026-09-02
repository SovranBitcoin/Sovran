import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HistoryEntry, Manager } from "@cashu/coco-core";

import { logger } from "../logger";
import {
  listInFlightReceiveEntries,
  listPendingPaymentRequestEntries,
  mergeTransactionSources,
  sameTransactionList,
} from "../history/aggregate";
import { normalizeHistoryEntries } from "../history/normalize";
import { onPaymentRequestCreated } from "../paymentRequestEvents";
import {
  candidateKeys,
  mergeAnnotationRecords,
  mergeAnnotationsIntoEntry,
} from "../annotations";
import type { AnnotationStoreAdapter } from "../annotations";
import { useAnnotationStore, useColadaManager } from "./ColadaProvider";
import { useLatestRef } from "./useLatestRef";

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
 * Like `sameTransactionList` but also compares merged metadata, so an
 * annotation change (which mutates content without changing id/state)
 * re-renders the row while un-annotated rows keep their reference.
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
 * Annotates a list and keeps the PREVIOUS array whenever nothing a row
 * displays actually moved.
 *
 * The annotation store notifies on every write, including one for a
 * transaction that is not on screen, so without this an unrelated annotation
 * would hand every history consumer a brand-new list. The stabiliser owns its
 * own `previous` — a closure variable created once per hook instance, not a
 * ref. That distinction is the point: a ref read and written in render is what
 * the React Compiler refuses to compile past, and this hook feeding the
 * transaction list unmemoized is a worse trade than the render it saves.
 */
function createAnnotatedListStabiliser(): (
  entries: readonly HistoryEntry[],
  store: AnnotationStoreAdapter,
) => HistoryEntry[] {
  let previous: HistoryEntry[] = [];
  return (entries, store) => {
    const annotated = entries.map((entry) =>
      mergeAnnotationsIntoEntry(
        entry,
        mergeAnnotationRecords(store.getMany(candidateKeys(entry))),
      ),
    );
    if (sameAnnotatedList(previous, annotated)) return previous;
    previous = annotated;
    return annotated;
  };
}

/**
 * Keep the previous array whenever the display-relevant content (id + state
 * per row) is unchanged, so a refresh that returns the same rows cannot hand
 * consumers a brand-new list. Written to be passed straight to `setState`,
 * where React additionally short-circuits the re-render once the updater
 * returns the value it already holds.
 *
 * This is where list identity is now established. It used to be re-derived in
 * render from a snapshot ref after the merge — same guarantee, but a ref read
 * and written during render is a Rules-of-React violation, and it was one of
 * the reasons this hook never compiled.
 */
function keepIfSame(
  prev: HistoryEntry[],
  next: HistoryEntry[],
): HistoryEntry[] {
  return sameTransactionList(prev, next) ? prev : next;
}

/**
 * One page of coco history, normalized, or `[]` when the read failed.
 *
 * Module scope on purpose: the React Compiler cannot lower a `try` whose body
 * holds value blocks — `??`, ternaries, optional chaining — and this body is
 * built out of them. Leaving it inline in a `useCallback` is what kept the
 * whole hook uncompiled. Nothing here touches React.
 */
async function readHistoryPage(
  manager: Manager,
  offset: number,
  pageSize: number,
): Promise<HistoryEntry[]> {
  try {
    const raw =
      (await manager.history.getPaginatedHistory(offset, pageSize)) ?? [];
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
    // Render-order diagnostics: exactly what coco returned for this window,
    // in coco's order. Dates only — no amounts, mints, tokens.
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
  const [pendingRequestEntries, setPendingRequestEntries] = useState<
    HistoryEntry[]
  >([]);
  const [isFetching, setIsFetching] = useState(false);
  // `hasMore` is state, not a bare ref. It used to be read straight off
  // `hasMoreRef.current` in the returned object — a ref read during render,
  // which means the value the consumer gets is whatever the ref happened to
  // hold at the last render React decided to run. Nothing re-renders when the
  // ref moves, so an infinite-scroll list could keep asking for a page that no
  // longer exists, or stop asking while pages remained. The ref stays only as
  // the synchronous re-entry guard for `loadMore`, mirrored on every write —
  // the same split `isFetching`/`fetchingRef` already uses here.
  const [hasMore, setHasMore] = useState(true);
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
  // Written in useInsertionEffect rather than in the render body: a ref write
  // during render switches the React Compiler off for the whole hook, and a
  // discarded concurrent render must not mutate it. Every read is from a
  // callback or a coco event, all of which run after insertion effects.
  const managerRef = useLatestRef(manager);

  const setFetching = useCallback((value: boolean) => {
    fetchingRef.current = value;
    setIsFetching(value);
  }, []);

  const applyHasMore = useCallback((value: boolean) => {
    hasMoreRef.current = value;
    setHasMore(value);
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
    (offset: number) => readHistoryPage(managerRef.current, offset, pageSize),
    // The dep list names the ref the body reaches as well as `pageSize`. Refs
    // are stable, so this is longer, not looser — but a memo whose body reads
    // something the list does not name is one the compiler refuses to
    // preserve, and that stops it compiling the whole hook.
    [pageSize, managerRef],
  );

  const fetchSupplements = useCallback(async () => {
    try {
      const [receives, pendingRequests] = await Promise.all([
        listInFlightReceiveEntries(managerRef.current),
        listPendingPaymentRequestEntries(managerRef.current),
      ]);
      if (!mountedRef.current) return;
      setReceiveEntries((prev) => keepIfSame(prev, receives));
      setPendingRequestEntries((prev) => keepIfSame(prev, pendingRequests));
    } catch (err) {
      logger.warn("history.transactions.supplements_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [managerRef, mountedRef]);

  const refresh = useCallback(async () => {
    if (fetchingRef.current) return;
    setFetching(true);
    // `Promise.prototype.finally` rather than a `try`/`finally` statement,
    // here and in loadMore/goToPage below. The guarantee is identical — the
    // spinner stops and `fetchingRef` clears on success and on throw alike —
    // but the React Compiler cannot lower a `try` with a `finally`, and these
    // three statements were the whole reason this hook rendered unmemoized.
    const run = async () => {
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
            return keepIfSame(prev, [...page, ...fresh]);
          });
        }
      } else {
        const page = await fetchPage(offsetRef.current);
        if (mountedRef.current) {
          historyReasonRef.current = "refresh-window";
          setCocoHistory((prev) => keepIfSame(prev, page));
        }
      }
      await fetchSupplements();
    };
    await run().finally(() => setFetching(false));
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
      // Inside the guard, not before it. `hasMore` is state now, so a run this
      // effect already cancelled (a pageSize change, or the manager swapping)
      // would otherwise publish its page length as the live flag and either
      // stop pagination early or keep asking past the end.
      if (!cancelled && mountedRef.current) {
        applyHasMore(page.length === pageSize);
        historyReasonRef.current = "initial";
        setCocoHistory((prev) => keepIfSame(prev, page));
      }
      await fetchSupplements();
      if (!cancelled) setFetching(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    manager,
    pageSize,
    fetchPage,
    fetchSupplements,
    setFetching,
    applyHasMore,
  ]);

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

  // Incoming payment request created -> re-list active requests. coco emits no
  // event on incoming.create, so this in-package signal is the only trigger
  // that surfaces a freshly created "as Ecash" request without a restart.
  useEffect(
    () => onPaymentRequestCreated(() => void fetchSupplements()),
    [fetchSupplements],
  );

  const loadMore = useCallback(async () => {
    if (!hasMoreRef.current || fetchingRef.current) return;
    setFetching(true);
    modeRef.current = "infinite";
    const run = async () => {
      const nextOffset = offsetRef.current + pageSize;
      const page = await fetchPage(nextOffset);
      if (mountedRef.current) {
        applyHasMore(page.length === pageSize);
        historyReasonRef.current = "loadMore";
        setCocoHistory((prev) => {
          const seen = new Set<string>();
          const out: HistoryEntry[] = [];
          for (const entry of [...prev, ...page]) {
            if (seen.has(entry.id)) continue;
            seen.add(entry.id);
            out.push(entry);
          }
          return keepIfSame(prev, out);
        });
        offsetRef.current = nextOffset;
      }
    };
    await run().finally(() => setFetching(false));
  }, [fetchPage, pageSize, setFetching, applyHasMore]);

  const goToPage = useCallback(
    async (page: number) => {
      if (fetchingRef.current) return;
      setFetching(true);
      modeRef.current = "page";
      const run = async () => {
        const offset = page * pageSize;
        const result = await fetchPage(offset);
        if (mountedRef.current) {
          applyHasMore(result.length === pageSize);
          historyReasonRef.current = "goToPage";
          setCocoHistory((prev) => keepIfSame(prev, result));
          offsetRef.current = offset;
        }
      };
      await run().finally(() => setFetching(false));
    },
    [fetchPage, pageSize, setFetching, applyHasMore],
  );

  // Merge sources. Identity is already stable: each source keeps its previous
  // array whenever `sameTransactionList` says the display-relevant content is
  // unchanged (see `keepIfSame`), so an unchanged refresh does not move this
  // memo's inputs and consumers never see a new list for the same rows.
  //
  // This used to be a render-time snapshot ref compared after the merge. Same
  // guarantee, but reading and writing a ref in render is a Rules-of-React
  // violation the compiler refuses to compile past — and it took the whole
  // hook down with it. Stabilising at the source is also cheaper: a no-op
  // `setState` short-circuits before React even schedules a render.
  const baseHistory = useMemo(
    () =>
      mergeTransactionSources({
        cocoHistory,
        receiveEntries,
        pendingRequestEntries,
      }),
    [cocoHistory, receiveEntries, pendingRequestEntries],
  );

  // Merge per-transaction annotations into each entry's metadata. Un-annotated
  // rows keep their reference (mergeAnnotationsIntoEntry is identity on empty),
  // and the stabiliser keeps the whole list's reference unless an annotation
  // that is actually on screen changed. `annotationVersion` is the cache key
  // for the store read: it is bumped by the subscription above, which is the
  // only thing that can change what `getMany` returns.
  const [annotateList] = useState(createAnnotatedListStabiliser);
  const history = useMemo(
    () => annotateList(baseHistory, annotationStore),
    [annotateList, baseHistory, annotationStore, annotationVersion],
  );

  return useMemo(
    () => ({
      history,
      loadMore,
      goToPage,
      refresh,
      hasMore,
      isFetching,
    }),
    [history, loadMore, goToPage, refresh, hasMore, isFetching],
  );
}
