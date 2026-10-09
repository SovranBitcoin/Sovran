import { useSyncExternalStore } from "react";
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
import { createSharedReadStore, type SharedReadStore } from "./sharedReadStore";

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
 * Annotates a list and keeps the PREVIOUS array whenever nothing a row
 * displays actually moved.
 *
 * The annotation store notifies on every write, including one for a
 * transaction that is not on screen, so without this an unrelated annotation
 * would hand every history consumer a brand-new list. The stabiliser owns its
 * own `previous` in the shared annotation view. External-store notifications
 * recompute that view directly, so the compiler cannot cache an annotation
 * read behind a version dependency that its body does not read.
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
    if (sameTransactionList(previous, annotated)) return previous;
    previous = annotated;
    return annotated;
  };
}

/** Keep list identity when the complete display-relevant row content is unchanged. */
function keepIfSame(
  prev: HistoryEntry[],
  next: HistoryEntry[],
): HistoryEntry[] {
  return sameTransactionList(prev, next) ? prev : next;
}

/**
 * One page of coco history, normalized, or `null` when the read failed (not an empty page).
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
): Promise<HistoryEntry[] | null> {
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
    return null;
  }
}

async function readSupplements(manager: Manager) {
  try {
    const [receives, pendingRequests] = await Promise.all([
      listInFlightReceiveEntries(manager),
      listPendingPaymentRequestEntries(manager),
    ]);
    return { receives, pendingRequests };
  } catch (err) {
    logger.warn("history.transactions.supplements_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
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
  const store = transactionStore(manager, pageSize, annotationStore);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

const transactions = new WeakMap<Manager, Map<number, {
  base: SharedReadStore<UseColadaTransactionsResult>;
  annotated: WeakMap<AnnotationStoreAdapter, SharedReadStore<UseColadaTransactionsResult>>;
}>>();

function transactionStore(
  manager: Manager,
  pageSize: number,
  annotationStore: AnnotationStoreAdapter,
): SharedReadStore<UseColadaTransactionsResult> {
  let sizes = transactions.get(manager);
  if (!sizes) {
    sizes = new Map();
    transactions.set(manager, sizes);
  }
  let scope = sizes.get(pageSize);
  if (!scope) {
    scope = { base: createTransactionStore(manager, pageSize), annotated: new WeakMap() };
    sizes.set(pageSize, scope);
  }
  let view = scope.annotated.get(annotationStore);
  if (!view) {
    const base = scope.base;
    const annotate = createAnnotatedListStabiliser();
    let previous: UseColadaTransactionsResult | undefined;
    const project = () => {
      const snapshot = base.getSnapshot();
      const history = annotate(snapshot.history, annotationStore);
      if (previous && previous.history === history &&
          previous.hasMore === snapshot.hasMore &&
          previous.isFetching === snapshot.isFetching &&
          previous.refresh === snapshot.refresh) return previous;
      previous = { ...snapshot, history };
      return previous;
    };
    view = createSharedReadStore(project, (publish) => {
      const onChange = () => publish(project());
      const offAnnotations = annotationStore.subscribe(onChange);
      const offBase = base.subscribe(onChange);
      onChange();
      return () => {
        offAnnotations();
        offBase();
      };
    });
    scope.annotated.set(annotationStore, view);
  }
  return view;
}

function emptyTransactions(): UseColadaTransactionsResult {
  return {
    history: [], hasMore: true, isFetching: false,
    loadMore: async () => {}, goToPage: async () => {}, refresh: async () => {},
  };
}

function createTransactionStore(
  manager: Manager,
  pageSize: number,
): SharedReadStore<UseColadaTransactionsResult> {
  return createSharedReadStore(emptyTransactions, (publish) => {
    // Everything below belongs to this subscription lifetime. Cleanup retires
    // its reads and callbacks even if the same scope immediately remounts.
    let cancelled = false;
    let cocoHistory: HistoryEntry[] = [];
    let receiveEntries: HistoryEntry[] = [];
    let pendingRequestEntries: HistoryEntry[] = [];
    let history: HistoryEntry[] = [];
    let isFetching = false;
    let hasMore = true;
    let offset = -pageSize;
    let mode: "infinite" | "page" = "infinite";
    let refreshPending = false;
    let supplementRead: { requested: boolean; promise: Promise<void> } | null = null;

    const emit = () => {
      if (cancelled) return;
      history = keepIfSame(history, mergeTransactionSources({
        cocoHistory, receiveEntries, pendingRequestEntries,
      }));
      publish({ history, loadMore, goToPage, refresh, hasMore, isFetching });
    };
    const applyHistory = (next: HistoryEntry[], reason: string) => {
      const previous = cocoHistory;
      cocoHistory = keepIfSame(previous, next);
      if (cocoHistory !== previous) {
        logger.info("history.state.applied", {
          reason, mode, offset, ...summarizeEntries(cocoHistory),
        });
      }
      emit();
    };
    const setFetching = (value: boolean) => {
      isFetching = value;
      emit();
      if (!value && refreshPending && !cancelled) {
        refreshPending = false;
        void refresh();
      }
    };
    const fetchPage = (offset: number) => readHistoryPage(manager, offset, pageSize);
    const fetchSupplements = () => {
      if (cancelled) return Promise.resolve();
      if (supplementRead) {
        supplementRead.requested = true;
        return supplementRead.promise;
      }
      const work = { requested: true, promise: Promise.resolve() };
      supplementRead = work;
      const run = async () => {
        while (work.requested && !cancelled) {
          work.requested = false;
          const next = await readSupplements(manager);
          if (!next || work.requested || cancelled) continue;
          receiveEntries = keepIfSame(receiveEntries, next.receives);
          pendingRequestEntries = keepIfSame(pendingRequestEntries, next.pendingRequests);
          emit();
        }
      };
      work.promise = run().finally(() => {
        if (supplementRead === work) supplementRead = null;
      });
      return work.promise;
    };
    const refresh = async () => {
      if (cancelled) return;
      if (isFetching) {
        refreshPending = true;
        return;
      }
      setFetching(true);
      const run = async () => {
        const supplements = fetchSupplements();
        if (mode === "infinite") {
          // Refresh the head at any scroll depth without dropping older pages.
          const page = await fetchPage(0);
          if (page && !cancelled) {
            if (offset <= 0) hasMore = page.length === pageSize;
            offset = Math.max(0, offset);
            const pageIds = new Set(page.map((n) => n.id));
            const fresh = cocoHistory.filter((p) => !pageIds.has(p.id));
            applyHistory([...page, ...fresh], "refresh-head");
          }
        } else {
          const page = await fetchPage(offset);
          if (page && !cancelled) {
            hasMore = page.length === pageSize;
            applyHistory(page, "refresh-window");
          }
        }
        await supplements;
      };
      await run().finally(() => { if (!cancelled) setFetching(false); });
    };
    const loadMore = async () => {
      if (cancelled || !hasMore || isFetching) return;
      setFetching(true);
      const run = async () => {
        const nextOffset = offset + pageSize;
        const page = await fetchPage(nextOffset);
        if (page && !cancelled) {
          hasMore = page.length === pageSize;
          mode = "infinite";
          const seen = new Set<string>();
          const out: HistoryEntry[] = [];
          for (const entry of [...cocoHistory, ...page]) {
            if (seen.has(entry.id)) continue;
            seen.add(entry.id);
            out.push(entry);
          }
          offset = nextOffset;
          applyHistory(out, "loadMore");
        }
      };
      await run().finally(() => { if (!cancelled) setFetching(false); });
    };
    const goToPage = async (page: number) => {
      if (cancelled || isFetching) return;
      setFetching(true);
      const run = async () => {
        const nextOffset = page * pageSize;
        const result = await fetchPage(nextOffset);
        if (result && !cancelled) {
          hasMore = result.length === pageSize;
          mode = "page";
          offset = nextOffset;
          applyHistory(result, "goToPage");
        }
      };
      await run().finally(() => { if (!cancelled) setFetching(false); });
    };

    const onHistory = () => void refresh();
    const onReceive = () => void fetchSupplements();
    manager.on("history:updated", onHistory);
    const receiveEvents = [
      "receive-op:prepared", "receive-op:finalized", "receive-op:rolled-back", "proofs:saved",
    ] as const;
    for (const event of receiveEvents) manager.on(event, onReceive);
    const offRequests = onPaymentRequestCreated(onReceive);
    setFetching(true);
    void (async () => {
      const supplements = fetchSupplements();
      const page = await fetchPage(0);
      if (page && !cancelled) {
        hasMore = page.length === pageSize;
        offset = 0;
        applyHistory(page, "initial");
      }
      await supplements;
      if (!cancelled) setFetching(false);
    })();
    return () => {
      cancelled = true;
      manager.off("history:updated", onHistory);
      for (const event of receiveEvents) manager.off(event, onReceive);
      offRequests();
    };
  });
}
