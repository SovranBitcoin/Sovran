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
import type { DmEnvelopePage } from '../data/dmEnvelopeTypes';
import { createDmEnvelopeCursor } from '../data/dmPagination';

interface DmEnvelopePagesOptions {
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
  onPage: (page: DmEnvelopePage) => number | void;
  /** Threads skip unrelated inbox pages without requiring a scrollable message. */
  continueWhileEmpty?: boolean;
  /** Drop everything accumulated so far, before a fresh first page. */
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
}): Promise<boolean> {
  let until = ctx.until;
  while (!ctx.signal.aborted) {
    const page = await ctx.fetchPage({ until, refresh: ctx.refresh, signal: ctx.signal });
    if (ctx.signal.aborted) return false;
    const fresh = ctx.cursor.track(page);
    const visible = ctx.onPage(page);
    const hasMore = page.envelopes.length >= ctx.pageLimit && fresh > 0;
    until = ctx.cursor.nextUntil();
    if (!ctx.continueWhileEmpty || visible !== 0 || !hasMore || until === undefined) return hasMore;
  }
  return false;
}

export function useDmEnvelopePages({
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
  // `loading` starts false and only flips true once the fetch effect runs, so a
  // consumer that gates a first-load spinner on `!loading` would hide it on the
  // very first render (before the fetch starts) and flash partial data. This
  // latches true only after the first real fetch settles, so a list can wait for
  // genuine results instead of rendering early.
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

  useEffect(() => {
    if (!feedKey) {
      onResetRef.current();
      setHasMore(false);
      setLoading(false);
      setHasLoadedOnce(false);
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    const cursor = createDmEnvelopeCursor();
    cursorRef.current = cursor;
    loadingMoreRef.current = false;
    const fetchPage = fetchPageRef.current;
    const onPage = onPageRef.current;
    onResetRef.current();
    setError(null);
    setLoading(true);
    void (async () => {
      await hydrateRef.current();
      if (controller.signal.aborted) return;
      const more = await readDmPages({
        refresh: refreshKey > 0,
        pageLimit,
        cursor,
        fetchPage,
        onPage,
        signal: controller.signal,
        continueWhileEmpty,
      });
      if (!controller.signal.aborted) setHasMore(more);
    })()
      .catch((e) => {
        if (controller.signal.aborted) return;
        const err = e instanceof Error ? e : new Error(String(e));
        paymentLog.warn(failureEventRef.current, { error: err.message });
        setError(err);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setHasLoadedOnce(true);
        }
      });
    return () => controller.abort();
  }, [
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

  return { loading, hasLoadedOnce, hasMore, loadMore, refresh, error };
}
