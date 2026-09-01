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
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
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
  onPage: (page: DmEnvelopePage) => void;
  /** Drop everything accumulated so far, before a fresh first page. */
  onReset: () => void;
  /** Log event for a failed first page. */
  failureEvent: string;
}

/** The `loadMore` fetch body, verbatim: fetch one older page and track it. */
async function fetchNextDmPage(ctx: {
  until: number;
  pageLimit: number;
  cursor: ReturnType<typeof createDmEnvelopeCursor>;
  fetchPage: DmEnvelopePagesOptions['fetchPage'];
  onPage: DmEnvelopePagesOptions['onPage'];
  loadingMoreRef: MutableRefObject<boolean>;
  setHasMore: (hasMore: boolean) => void;
  setError: (error: Error | null) => void;
}): Promise<void> {
  const { until, pageLimit, cursor, fetchPage, onPage, loadingMoreRef, setHasMore, setError } = ctx;
  loadingMoreRef.current = true;
  try {
    const page = await fetchPage({ until, refresh: false });
    const fresh = cursor.track(page);
    onPage(page);
    // Stop on a short page (the end) OR a full page with nothing new — the
    // server ignored `until`, or this window is drained. A page can be full
    // of envelopes yet hold no messages for the caller's filter, so "nothing
    // new" has to mean new ENVELOPES, not new results.
    setHasMore(page.envelopes.length >= pageLimit && fresh > 0);
  } catch (e) {
    setError(e instanceof Error ? e : new Error(String(e)));
  } finally {
    loadingMoreRef.current = false;
  }
}

export function useDmEnvelopePages({
  feedKey,
  pageLimit,
  hydrate,
  fetchPage,
  onPage,
  onReset,
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

  const hydrateRef = useLatestRef(hydrate);
  const fetchPageRef = useLatestRef(fetchPage);
  const onPageRef = useLatestRef(onPage);
  const onResetRef = useLatestRef(onReset);
  const failureEventRef = useLatestRef(failureEvent);

  useEffect(() => {
    if (!feedKey) {
      onResetRef.current();
      setHasMore(false);
      return;
    }
    const controller = new AbortController();
    cursorRef.current.reset();
    onResetRef.current();
    setError(null);
    setLoading(true);
    void (async () => {
      await hydrateRef.current();
      const page = await fetchPageRef.current({
        refresh: refreshKey > 0,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      cursorRef.current.track(page);
      onPageRef.current(page);
      if (!controller.signal.aborted) setHasMore(page.envelopes.length >= pageLimit);
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
    refreshKey,
    failureEventRef,
    fetchPageRef,
    hydrateRef,
    onPageRef,
    onResetRef,
  ]);

  const loadMore = useCallback(async () => {
    const until = cursorRef.current.nextUntil();
    if (loadingMoreRef.current || !hasMore || !feedKey || until === undefined) return;
    await fetchNextDmPage({
      until,
      pageLimit,
      cursor: cursorRef.current,
      fetchPage: fetchPageRef.current,
      onPage: onPageRef.current,
      loadingMoreRef,
      setHasMore,
      setError,
    });
  }, [hasMore, feedKey, pageLimit, fetchPageRef, onPageRef]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return { loading, hasLoadedOnce, hasMore, loadMore, refresh, error };
}
