/**
 * Page-0 owner for the Notifications tabs and the Follows detail screen.
 *
 * `useCachedRead` over the page-0 query cache is the single source of the
 * visible page: a tab whose page is cached paints it synchronously (no
 * `null` + spinner on a tab switch), a fresh page costs zero round-trips, a
 * stale one revalidates in the background, and every arrival is logged under
 * `read.notifications.*` / `read.followers.*`.
 *
 * The unified three-source session (nagg + Primal + relays, concurrent) is
 * opened by the fetcher and lives until the screen blurs or the next read.
 * Its in-place updates (count bumps, shape/profile upgrades) re-write the
 * cached page; genuinely new rows wait for the next load-more (the session's
 * no-shift contract). Pagination stays ephemeral: pages after the first live
 * in React state keyed by the page-0 key and are dropped on refresh/key change.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError } from '@/shared/lib/errors';
import { feedLog } from '@/shared/lib/logger';
import { useCachedRead } from '@/shared/lib/read/useCachedRead';
import { readEvents, readKeyHash } from '@/shared/lib/read/readLog';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
import {
  readIsUnavailable,
  type AppNotificationsSession,
  type FeedNotificationsRequest,
  type FeedNotificationsResult,
} from '@/features/feed/data/feedClient';
import { getFeedClient } from '@/features/feed/data/useFeedClient';
import {
  notificationsPageCache,
  notificationsPageKey,
} from '@/features/feed/data/notificationsCache';
import {
  notificationFollowersCache,
  notificationFollowersKey,
} from '@/features/feed/data/notificationFollowersCache';
import {
  emptyNotificationsResult,
  filterNotificationsResult,
  mergeNotificationsResult,
  notificationDedupeKey,
} from '@/features/feed/lib/notificationResults';

const NOTIFICATIONS_PAGE_SIZE = 50;
const FOLLOW_PAGE_SIZE = 50;
const FOLLOW_FETCH_MAX_PAGES = 4;

type Policy = FeedNotificationsRequest['policy'];
type ReplyScope = FeedNotificationsRequest['replyScope'];
type ServerTab = NonNullable<FeedNotificationsRequest['tab']>;

/** An unavailable answer with nothing to show is a failed read, not an empty one (SYSTEM.md F06). */
function unavailableAndEmpty(page: FeedNotificationsResult): boolean {
  return readIsUnavailable(page.read) && page.notifications.length === 0;
}

function classifyPage(page: FeedNotificationsResult): 'ready' | 'empty' | 'error' {
  if (unavailableAndEmpty(page)) return 'error';
  return page.notifications.length === 0 ? 'empty' : 'ready';
}

/**
 * One page of notifications from the feed client, with the client disposed
 * whatever happens. Module scope: React Compiler cannot lower a `try` with a
 * `finally`, and an inline body would cost the screen its memoization.
 */
async function fetchNotificationsFromRelay(
  request: Pick<
    FeedNotificationsRequest,
    'viewerPubkey' | 'tab' | 'policy' | 'replyScope' | 'until' | 'refresh' | 'signal' | 'readId'
  >
): Promise<FeedNotificationsResult> {
  const client = getFeedClient();
  try {
    return await client.getNotifications({ ...request, limit: NOTIFICATIONS_PAGE_SIZE });
  } finally {
    client.dispose?.();
  }
}

type ExtraPages = { key: string; result: FeedNotificationsResult };

type SessionOwner = {
  current: AppNotificationsSession | null;
  unsubscribe: (() => void) | null;
};

function closeSessionOwner(owner: SessionOwner): void {
  owner.unsubscribe?.();
  owner.unsubscribe = null;
  owner.current?.close();
  owner.current = null;
}

/**
 * Advance the list by one page: through the session (its cursors, dedupe and
 * pooled-row reveal) or the relay-backed cursor walk. Module scope: React
 * Compiler cannot lower a `try` with a `finally`; `onSettled` is the caller's.
 */
async function runLoadMore(args: {
  key: string;
  base: FeedNotificationsResult;
  session: AppNotificationsSession | null;
  isCurrentSession: (session: AppNotificationsSession) => boolean;
  request: { viewerPubkey: string; tab: ServerTab; policy: Policy; replyScope: ReplyScope };
  hasMoreRef: React.MutableRefObject<boolean>;
  seenKeysRef: React.MutableRefObject<Set<string>>;
  setExtra: (extra: ExtraPages) => void;
  onSettled: () => void;
}): Promise<void> {
  const { key, base, session, request, hasMoreRef, seenKeysRef, setExtra } = args;
  const logFields = { tab: request.tab, policy: request.policy, replyScope: request.replyScope };
  try {
    if (session) {
      const page = { ...(await session.loadMore()), hasNextPage: session.hasMore() };
      if (!args.isCurrentSession(session)) return;
      hasMoreRef.current = session.hasMore();
      setExtra({ key, result: page });
      feedLog.info('feed.notifications.ui.load_more', {
        ...logFields,
        transport: 'session',
        pageResults: page.notifications.length,
        pending: session.pendingCount(),
        hasMore: hasMoreRef.current,
      });
      return;
    }
    const cursor = base.paginationUntil;
    const page = await fetchNotificationsFromRelay({ ...request, until: cursor, refresh: false });
    const newKeys = page.notifications
      .map(notificationDedupeKey)
      .filter((dedupeKey) => !seenKeysRef.current.has(dedupeKey));
    const advanced = page.paginationUntil > 0 && page.paginationUntil < cursor;
    // Stop only when a page adds nothing new or the cursor can't advance —
    // grouping makes the raw item count an unreliable "has more" signal.
    hasMoreRef.current = newKeys.length > 0 && advanced;
    if (newKeys.length > 0) {
      for (const dedupeKey of newKeys) seenKeysRef.current.add(dedupeKey);
      const merged = mergeNotificationsResult(base, page);
      setExtra({
        key,
        result: { ...merged, paginationUntil: advanced ? page.paginationUntil : cursor },
      });
    }
    feedLog.info('feed.notifications.ui.load_more', {
      ...logFields,
      cursor,
      pageResults: page.notifications.length,
      newItems: newKeys.length,
      advanced,
      hasMore: hasMoreRef.current,
    });
  } catch (error) {
    feedLog.warn('feed.notifications.load_more_failed', {
      ...logFields,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    args.onSettled();
  }
}

interface NotificationsPageArgs {
  viewerPubkey: string | undefined;
  tab: ServerTab;
  policy: Policy;
  replyScope: ReplyScope;
  ownEventIds: string[];
  /** False for demo mode and client-only tabs: no read runs at all. */
  enabled: boolean;
}

interface NotificationsPage {
  /** The visible page (page 0 from the cache, plus any loaded-more pages). */
  result: FeedNotificationsResult | null;
  /** First paint with nothing cached for this key. */
  isInitialLoading: boolean;
  /** A user-triggered refresh is in flight over visible rows. */
  isRefreshing: boolean;
  isLoadingMore: boolean;
  /** Curated failure text; rows (if any) stay on screen. */
  errorMessage: string | null;
  refresh: () => void;
  loadMore: () => Promise<void>;
  readId: string | null;
}

export function useNotificationsPage(args: NotificationsPageArgs): NotificationsPage {
  const { viewerPubkey, tab, policy, replyScope, ownEventIds, enabled } = args;
  const key =
    enabled && viewerPubkey
      ? notificationsPageKey({
          viewerPubkey,
          tab,
          policy: policy ?? '',
          replyScope: replyScope ?? '',
        })
      : null;
  const viewerKey = viewerPubkey ?? '';

  const sessionRef = useRef<SessionOwner>({ current: null, unsubscribe: null });
  const [extra, setExtra] = useState<ExtraPages | null>(null);
  const extraRef = useLatestRef(extra);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(false);
  const seenKeysRef = useRef<Set<string>>(new Set());
  const ownEventIdsRef = useLatestRef(ownEventIds);

  const read = useCachedRead<FeedNotificationsResult>({
    store: notificationsPageCache,
    surface: 'notifications',
    key,
    viewerKey,
    strategy: 'session',
    // The session is torn down on blur; a late first page would be wrong.
    abortOnBlur: true,
    classify: classifyPage,
    fetcher: async ({ signal, readId, mode }) => {
      const owner = sessionRef.current;
      closeSessionOwner(owner);
      if (!viewerPubkey || !key) throw new Error('notifications read without a viewer');
      const request = {
        viewerPubkey,
        tab,
        policy,
        replyScope,
        refresh: mode === 'refresh',
        signal,
        readId,
      };
      // Unified session first: all three sources concurrently, one merged page.
      // Falls back to the one-shot waterfall when the client/layer can't serve
      // a session (legacy transport, no facade layer).
      const client = getFeedClient();
      const session =
        client.openNotificationsSession?.({
          ...request,
          limit: NOTIFICATIONS_PAGE_SIZE,
          ownEventIds: ownEventIdsRef.current,
        }) ?? null;
      client.dispose?.();
      if (!session) {
        const page = await fetchNotificationsFromRelay(request);
        // Never cache an unavailable answer: the next open should retry.
        if (unavailableAndEmpty(page)) throw new Error('notifications unavailable');
        hasMoreRef.current = page.paginationUntil > 0;
        seenKeysRef.current = new Set(page.notifications.map(notificationDedupeKey));
        return { data: page };
      }
      owner.current = session;
      signal?.addEventListener('abort', () => {
        if (owner.current === session) closeSessionOwner(owner);
      });
      const page = await session.firstPage();
      if (signal?.aborted || owner.current !== session)
        throw new Error('notifications read aborted');
      hasMoreRef.current = session.hasMore();
      seenKeysRef.current = new Set(page.notifications.map(notificationDedupeKey));
      // In-place updates only (count bumps, shape/profile upgrades, pool count):
      // row ids are stable, so the list updates without remounting or shifting.
      // They re-write the cached page (or the loaded-more snapshot once one
      // exists); new rows wait for the next load-more.
      owner.unsubscribe = session.subscribe(() => {
        if (owner.current !== session) return;
        const snapshot = { ...session.snapshot(), hasNextPage: session.hasMore() };
        hasMoreRef.current = session.hasMore();
        readEvents.merged({
          readId,
          surface: 'notifications',
          keyHash: readKeyHash(key),
          tier: snapshot.read?.sources?.[0] ?? 'relay',
          added: 0,
          updated: snapshot.notifications.length,
          complete: session.pendingCount() === 0,
        });
        if (extraRef.current?.key === key) setExtra({ key, result: snapshot });
        else notificationsPageCache.setEntry(key, snapshot, { viewerKey: viewerPubkey });
      });
      return { data: page };
    },
  });

  // Blur/unmount: the session is a per-focus resource.
  useEffect(() => {
    const owner = sessionRef.current;
    return () => closeSessionOwner(owner);
  }, []);
  useEffect(() => {
    // A key change or refresh drops the loaded-more pages: page 0 is the cache's.
    if (!read.isFetching) return;
    if (read.mode === 'refresh' || read.mode === 'initial') setExtra(null);
  }, [read.isFetching, read.mode]);

  const visible = extra && extra.key === key ? extra.result : (read.data ?? null);

  const loadMore = useCallback(async () => {
    if (!key || !viewerPubkey) return;
    if (loadingMoreRef.current || read.status === 'loading' || read.isFetching) return;
    const session = sessionRef.current.current;
    const base =
      extraRef.current?.key === key
        ? extraRef.current.result
        : notificationsPageCache.getEntry(key)?.data;
    if (!base) return;
    if (session ? !session.hasMore() : !hasMoreRef.current || base.paginationUntil <= 0) return;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    await runLoadMore({
      key,
      base,
      session,
      isCurrentSession: (s) => sessionRef.current.current === s,
      request: { viewerPubkey, tab, policy, replyScope },
      hasMoreRef,
      seenKeysRef,
      setExtra,
      onSettled: () => {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      },
    });
  }, [key, viewerPubkey, tab, policy, replyScope, read.status, read.isFetching, extraRef]);

  const refresh = useCallback(() => {
    setExtra(null);
    read.refresh();
  }, [read]);

  return {
    result: visible,
    isInitialLoading: !!key && read.status === 'loading',
    isRefreshing: read.isFetching && read.mode === 'refresh',
    isLoadingMore,
    errorMessage: read.error ? describeError(read.error, 'nagg').text : null,
    refresh,
    loadMore,
    readId: read.readId,
  };
}

// ---------------------------------------------------------------------------
// Follows detail: the ungrouped follow list, walked from the ALL tab.
// ---------------------------------------------------------------------------

/**
 * Walk up to {@link FOLLOW_FETCH_MAX_PAGES} pages of the ALL tab, keeping only
 * the follow notifications, with the feed client disposed whatever happens.
 */
async function fetchFollowPages(args: {
  viewerPubkey: string;
  policy: Policy;
  replyScope: ReplyScope;
  signal: AbortSignal | undefined;
  readId?: string;
  until?: number;
  refresh?: boolean;
}): Promise<{ result: FeedNotificationsResult; hasMore: boolean }> {
  const client = getFeedClient();
  let cursor = args.until;
  let merged = emptyNotificationsResult();
  let hasMore = false;
  try {
    for (let pageIndex = 0; pageIndex < FOLLOW_FETCH_MAX_PAGES; pageIndex += 1) {
      const page = await client.getNotifications({
        viewerPubkey: args.viewerPubkey,
        tab: 'ALL',
        policy: args.policy,
        replyScope: args.replyScope,
        limit: FOLLOW_PAGE_SIZE,
        until: cursor,
        refresh: args.refresh && pageIndex === 0,
        // The detail screen needs the full ungrouped follow list, not the
        // collapsed group the All tab renders.
        grouped: false,
        signal: args.signal,
        readId: args.readId,
      });
      if (args.signal?.aborted) throw new Error('follows read aborted');
      if (unavailableAndEmpty(page) && pageIndex === 0) throw new Error('follows unavailable');
      const followPage = filterNotificationsResult(page, (n) => n.reason === 'follow');
      merged = mergeNotificationsResult(merged, followPage);
      merged.paginationUntil = page.paginationUntil;
      hasMore = page.paginationUntil > 0 && page.notifications.length >= FOLLOW_PAGE_SIZE;
      cursor = page.paginationUntil;
      if (followPage.notifications.length > 0 || !hasMore || cursor <= 0) break;
    }
  } finally {
    client.dispose?.();
  }
  return { result: merged, hasMore };
}

/** Append one more page of followers, or log and leave the list as it was.
 *  Module scope: React Compiler cannot lower a `try` with a `finally`. */
async function runLoadMoreFollowers(args: {
  key: string;
  base: FeedNotificationsResult;
  request: { viewerPubkey: string; policy: Policy; replyScope: ReplyScope };
  hasMoreRef: React.MutableRefObject<boolean>;
  setExtra: (extra: ExtraPages) => void;
  onSettled: () => void;
}): Promise<void> {
  const { key, base, request, hasMoreRef, setExtra } = args;
  const cursor = base.paginationUntil;
  try {
    const { result: page, hasMore } = await fetchFollowPages({
      ...request,
      signal: undefined,
      until: cursor,
      refresh: false,
    });
    const advanced = page.paginationUntil > 0 && page.paginationUntil < cursor;
    hasMoreRef.current = hasMore && advanced;
    const merged = mergeNotificationsResult(base, page);
    setExtra({
      key,
      result: { ...merged, paginationUntil: advanced ? page.paginationUntil : cursor },
    });
    feedLog.info('feed.notification_followers.load_more', {
      cursor,
      pageResults: page.notifications.length,
      advanced,
      hasMore: hasMoreRef.current,
    });
  } catch (error) {
    feedLog.warn('feed.notification_followers.load_more_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    args.onSettled();
  }
}

interface FollowersPageArgs {
  viewerPubkey: string | undefined;
  policy: Policy;
  replyScope: ReplyScope;
  /** One-shot hand-over from the notifications screen (already taken by the caller). */
  seed: FeedNotificationsResult | undefined;
}

export function useNotificationFollowersPage(args: FollowersPageArgs): NotificationsPage {
  const { viewerPubkey, policy, replyScope, seed } = args;
  const key = viewerPubkey ? notificationFollowersKey(viewerPubkey) : null;
  const viewerKey = viewerPubkey ?? '';
  const [extra, setExtra] = useState<ExtraPages | null>(null);
  const extraRef = useLatestRef(extra);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(seed ? seed.paginationUntil > 0 : false);

  const read = useCachedRead<FeedNotificationsResult>({
    store: notificationFollowersCache,
    surface: 'followers',
    key,
    viewerKey,
    seed: () => seed,
    // A real hand-over is this session's freshest page: it becomes the cached
    // entry so the first focus costs no round-trip.
    seedFresh: true,
    classify: classifyPage,
    fetcher: async ({ signal, readId, mode }) => {
      if (!viewerPubkey) throw new Error('follows read without a viewer');
      const { result, hasMore } = await fetchFollowPages({
        viewerPubkey,
        policy,
        replyScope,
        signal,
        readId,
        refresh: mode === 'refresh',
      });
      hasMoreRef.current = hasMore;
      return { data: result };
    },
  });

  useEffect(() => {
    if (!read.isFetching) return;
    if (read.mode === 'refresh' || read.mode === 'initial') setExtra(null);
  }, [read.isFetching, read.mode]);

  const visible = extra && extra.key === key ? extra.result : (read.data ?? null);

  const loadMore = useCallback(async () => {
    if (!key || !viewerPubkey) return;
    if (loadingMoreRef.current || read.status === 'loading' || read.isFetching) return;
    if (!hasMoreRef.current) return;
    const base =
      extraRef.current?.key === key
        ? extraRef.current.result
        : notificationFollowersCache.getEntry(key)?.data;
    if (!base || base.paginationUntil <= 0) return;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    await runLoadMoreFollowers({
      key,
      base,
      request: { viewerPubkey, policy, replyScope },
      hasMoreRef,
      setExtra,
      onSettled: () => {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      },
    });
  }, [key, viewerPubkey, policy, replyScope, read.status, read.isFetching, extraRef]);
  const refresh = useCallback(() => {
    setExtra(null);
    read.refresh();
  }, [read]);

  return {
    result: visible,
    isInitialLoading: !!key && read.status === 'loading',
    isRefreshing: read.isFetching && read.mode === 'refresh',
    isLoadingMore,
    errorMessage: read.error ? describeError(read.error, 'nagg').text : null,
    refresh,
    loadMore,
    readId: read.readId,
  };
}
