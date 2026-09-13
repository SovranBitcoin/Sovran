/**
 * The paging engine both DM feeds run on: the conversation list and a single
 * thread walk the SAME shared gift-wrap inbox backwards, and each had grown its
 * own copy of the protocol — reset, hydrate, fetch, track the cursor, decide
 * whether another page exists, abort on unmount. Two copies meant two chances
 * to get the "stop paging" rule wrong, which is the rule that keeps a spinner
 * from looping forever.
 *
 * Callers supply what differs (which endpoint, which caches, what to do with a
 * page) and are freed from what doesn't. Callbacks are mirrored into refs and
 * the reload is keyed off `feedKey`, so a caller cannot cause a refetch loop by
 * passing an unmemoized closure — the identity of the feed is stated, not
 * inferred from dependency arrays.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { paymentLog } from '@/shared/lib/logger';
import {
  newReadId,
  readErrorType,
  readEvents,
  readKeyHash,
  type ReadSurface,
} from '@/shared/lib/read/readLog';
import type { DmEnvelopePage } from '../data/dmEnvelopeTypes';
import { createDmEnvelopeCursor } from '../data/dmPagination';

/** Why a page is being delivered: the first page of a fresh feed, a refresh's
 *  first page (replace, do not clear beforehand), a later page, or a live push. */
export type DmPageMeta = {
  first: boolean;
  mode: 'initial' | 'refresh' | 'loadMore' | 'live';
};

export type DmPagesStatus = 'idle' | 'loading' | 'revalidating' | 'ready' | 'error';

interface DmEnvelopePagesOptions {
  /** Read-lifecycle surface for the `read.<surface>.*` events. */
  surface: ReadSurface;
  /** True when the caller already shows a snapshot/seed for this feed (status revalidating, not loading). */
  hasSnapshot?: boolean;
  /**
   * Identity of the feed being paged (viewer, and for a thread its
   * counterparty + protocol). A change reloads from the first page.
   * `null` while the feed can't be loaded at all — results are cleared.
   */
  feedKey: string | null;
  pageLimit: number;
  /** Warm the decryption caches this feed reads, before the first fetch. */
  hydrate: () => Promise<void>;
  /** Fetch one page. `until` is undefined for the first page. */
  fetchPage: (args: {
    until?: number;
    refresh: boolean;
    signal?: AbortSignal;
  }) => Promise<DmEnvelopePage>;
  /** Consume a page, after the cursor has tracked it. */
  onPage: (page: DmEnvelopePage, meta: DmPageMeta) => number | void;
  /** Threads skip unrelated inbox pages without requiring a scrollable message. */
  continueWhileEmpty?: boolean;
  /**
   * Drop everything accumulated so far, before a fresh first page. Called on a
   * feed identity change only — a refresh keeps rows on screen and replaces
   * them when its first page lands (SYSTEM.md §7: never blank a cached list).
   */
  onReset: () => void;
  /** Log event for a failed first page. */
  failureEvent: string;
}

/** Read until the caller has a result, or the inbox ends/stops advancing. */
async function readDmPages(ctx: {
  until?: number;
  refresh: boolean;
  pageLimit: number;
  cursor: ReturnType<typeof createDmEnvelopeCursor>;
  fetchPage: DmEnvelopePagesOptions['fetchPage'];
  onPage: DmEnvelopePagesOptions['onPage'];
  signal: AbortSignal;
  continueWhileEmpty: boolean;
  mode: DmPageMeta['mode'];
}): Promise<boolean> {
  let until = ctx.until;
  let first = ctx.mode !== 'loadMore';
  while (!ctx.signal.aborted) {
    const page = await ctx.fetchPage({ until, refresh: ctx.refresh, signal: ctx.signal });
    if (ctx.signal.aborted) return false;
    const fresh = ctx.cursor.track(page);
    const visible = ctx.onPage(page, { first, mode: ctx.mode });
    first = false;
    const hasMore = page.envelopes.length >= ctx.pageLimit && fresh > 0;
    until = ctx.cursor.nextUntil();
    if (!ctx.continueWhileEmpty || visible !== 0 || !hasMore || until === undefined) return hasMore;
  }
  return false;
}

export function useDmEnvelopePages({
  surface,
  hasSnapshot = false,
  feedKey,
  pageLimit,
  hydrate,
  fetchPage,
  onPage,
  onReset,
  continueWhileEmpty = false,
  failureEvent,
}: DmEnvelopePagesOptions) {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Something is on screen for the current feed (a delivered page or the
  // caller's snapshot) — decides loading-vs-revalidating and error-vs-ready.
  const [painted, setPainted] = useState(false);
  // `loading` starts false and only flips true once the fetch effect runs, so a
  // consumer that gates a first-load spinner on `!loading` would hide it on the
  // very first render (before the fetch starts) and flash partial data. This
  // latches true after the first page settles, even if more unrelated inbox
  // pages must be searched before the caller has visible messages.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const cursorRef = useRef(createDmEnvelopeCursor());
  const loadingMoreRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  const hydrateRef = useLatestRef(hydrate);
  const fetchPageRef = useLatestRef(fetchPage);
  const onPageRef = useLatestRef(onPage);
  const onResetRef = useLatestRef(onReset);
  const failureEventRef = useLatestRef(failureEvent);
  const hasSnapshotRef = useLatestRef(hasSnapshot);
  // The feed identity the last run was for: a same-key rerun is a refresh.
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!feedKey) {
      lastKeyRef.current = null;
      onResetRef.current();
      setHasMore(false);
      setLoading(false);
      setRefreshing(false);
      setHasLoadedOnce(false);
      setPainted(false);
      return;
    }
    const mode: DmPageMeta['mode'] = lastKeyRef.current === feedKey ? 'refresh' : 'initial';
    lastKeyRef.current = feedKey;
    const controller = new AbortController();
    controllerRef.current = controller;
    const cursor = createDmEnvelopeCursor();
    cursorRef.current = cursor;
    loadingMoreRef.current = false;
    const fetchPage = fetchPageRef.current;
    const onPage = onPageRef.current;
    const readId = newReadId(surface);
    const keyHash = readKeyHash(feedKey);
    const t0 = Date.now();
    const seeded = hasSnapshotRef.current;
    readEvents.request({
      readId,
      surface,
      keyHash,
      mode,
      trigger: mode === 'refresh' ? 'user' : 'mount',
      action: seeded ? 'serve-stale-revalidate' : 'fetch',
      strategy: 'sequential',
      cached: seeded,
      stale: seeded,
      coldStart: !seeded,
      gen: 0,
    });
    if (mode === 'initial') {
      // A new feed: drop the previous one's rows — unless the caller already
      // painted a snapshot for this feed, which the first page then replaces.
      if (!seeded) onResetRef.current();
      setPainted(seeded);
      setHasLoadedOnce(seeded);
      setLoading(!seeded);
      setRefreshing(seeded);
    } else {
      // A refresh keeps everything on screen; its first page replaces in place.
      setRefreshing(true);
    }
    setError(null);
    let delivered = 0;
    void (async () => {
      await hydrateRef.current();
      if (controller.signal.aborted) return;
      const more = await readDmPages({
        refresh: mode === 'refresh',
        pageLimit,
        cursor,
        fetchPage,
        onPage: (page, meta) => {
          const visible = onPage(page, meta);
          delivered += page.envelopes.length;
          setHasLoadedOnce(true);
          setPainted(true);
          return visible;
        },
        signal: controller.signal,
        continueWhileEmpty,
        mode,
      });
      if (!controller.signal.aborted) setHasMore(more);
      readEvents.done({
        readId,
        surface,
        keyHash,
        gen: 0,
        durationMs: Date.now() - t0,
        source: 'network',
        count: delivered,
        empty: delivered === 0,
        degraded: false,
        complete: true,
      });
    })()
      .catch((e) => {
        if (controller.signal.aborted) {
          readEvents.superseded({ readId, surface, keyHash, gen: 0, reason: 'abort' });
          return;
        }
        const err = e instanceof Error ? e : new Error(String(e));
        paymentLog.warn(failureEventRef.current, { error: err.message });
        readEvents.failed({
          readId,
          surface,
          keyHash,
          gen: 0,
          durationMs: Date.now() - t0,
          errorType: readErrorType(err),
          retained: mode === 'refresh' || seeded,
        });
        setError(err);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
          setHasLoadedOnce(true);
        }
      });
    return () => controller.abort();
  }, [
    surface,
    hasSnapshotRef,
    feedKey,
    pageLimit,
    continueWhileEmpty,
    refreshKey,
    failureEventRef,
    fetchPageRef,
    hydrateRef,
    onPageRef,
    onResetRef,
  ]);

  const loadMore = useCallback(async () => {
    const until = cursorRef.current.nextUntil();
    const controller = controllerRef.current;
    if (
      loading ||
      loadingMoreRef.current ||
      !hasMore ||
      !feedKey ||
      until === undefined ||
      !controller ||
      controller.signal.aborted
    )
      return;
    loadingMoreRef.current = true;
    setError(null);
    await readDmPages({
      until,
      refresh: false,
      pageLimit,
      cursor: cursorRef.current,
      fetchPage: fetchPageRef.current,
      onPage: onPageRef.current,
      signal: controller.signal,
      continueWhileEmpty,
      mode: 'loadMore',
    })
      .then(
        (more) => {
          if (!controller.signal.aborted) setHasMore(more);
        },
        (error: unknown) => {
          if (!controller.signal.aborted)
            setError(error instanceof Error ? error : new Error(String(error)));
        }
      )
      .finally(() => {
        if (controllerRef.current === controller) loadingMoreRef.current = false;
      });
  }, [loading, hasMore, feedKey, pageLimit, continueWhileEmpty, fetchPageRef, onPageRef]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const inFlight = loading || refreshing;
  const status: DmPagesStatus = !feedKey
    ? 'idle'
    : inFlight
      ? painted
        ? 'revalidating'
        : 'loading'
      : error && !painted
        ? 'error'
        : 'ready';

  return { loading, refreshing, hasLoadedOnce, hasMore, loadMore, refresh, error, status };
}
