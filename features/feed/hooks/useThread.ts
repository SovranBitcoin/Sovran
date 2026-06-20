import { useCallback, useEffect, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';

import type {
  FeedEvent,
  NoteMetrics,
  ProfileInfo,
} from '@/features/feed/components/nostr/feedTypes';
import type {
  ThreadReplySort,
  ThreadResult,
  ThreadSeedBuckets,
} from '@/features/feed/data/feedClient';
import { getFeedClient } from '@/features/feed/data/useFeedClient';
import { consumeThreadSeed, type ThreadSeed } from '@/features/feed/lib/threadSeedCache';
import {
  bucketsFromThreadResult,
  buildThreadItemsFromResult,
  buildThreadItemsFromSeed,
  orderedReplyIdsForThreadResult,
  type BuiltThreadItems,
  type ThreadItem,
} from '@/features/feed/lib/threadItems';
import { feedLog } from '@/shared/lib/logger';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { ingestOwnContent, useOwnContentStore } from '@/shared/stores/profile/ownContentStore';

/**
 * Build a single-note thread seed from a locally-stored own note, so a just-
 * posted (or other-client) note opens its thread instantly even before it has
 * round-tripped through relays/nagg. Scoped to the active viewer.
 */
function ownContentSeed(eventId: string, viewerPubkey: string | undefined): ThreadSeed | undefined {
  const entry = useOwnContentStore.getState().getOwn(eventId, viewerPubkey);
  if (!entry) return undefined;
  return {
    allEvents: new Map([[eventId, entry.event]]),
    profiles: new Map(),
    metrics: new Map(),
    quotedEvents: new Map(),
  };
}

export type { ThreadItem } from '@/features/feed/lib/threadItems';

type UseThreadResult = {
  items: ThreadItem[];
  hiddenReplyCount: number;
  isLoading: boolean;
  isFetching: boolean;
  isLoadingMoreReplies: boolean;
  hasMoreReplies: boolean;
  replySort: ThreadReplySort;
  setReplySort: (sort: ThreadReplySort) => void;
  error: string | null;
  dataVersion: number;
  profilesRef: React.MutableRefObject<Map<string, ProfileInfo>>;
  metricsRef: React.MutableRefObject<Map<string, NoteMetrics>>;
  quotedEventsRef: React.MutableRefObject<Map<string, FeedEvent>>;
  loadMoreReplies: () => Promise<void>;
};

const THREAD_REPLY_PAGE_SIZE = 10;
const EMPTY_PROFILES: Map<string, ProfileInfo> = new Map();
const EMPTY_METRICS: Map<string, NoteMetrics> = new Map();
const EMPTY_QUOTED: Map<string, FeedEvent> = new Map();

export function useThread(eventId: string): UseThreadResult {
  const { keys: nostrKeys } = useNostrKeysContext();
  const viewerPubkey = nostrKeys?.pubkey;
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [hiddenReplyCount, setHiddenReplyCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [isLoadingMoreReplies, setIsLoadingMoreReplies] = useState(false);
  const [hasMoreReplies, setHasMoreReplies] = useState(false);
  const [replySort, setReplySort] = useState<ThreadReplySort>('relevant');
  const [error, setError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  const profilesRef = useRef<Map<string, ProfileInfo>>(EMPTY_PROFILES);
  const metricsRef = useRef<Map<string, NoteMetrics>>(EMPTY_METRICS);
  const quotedEventsRef = useRef<Map<string, FeedEvent>>(EMPTY_QUOTED);
  const threadSeedRef = useRef<ThreadSeedBuckets | null>(null);
  const replyOrderRef = useRef<string[]>([]);
  const replyOffsetRef = useRef(0);
  const hasMoreRepliesRef = useRef(false);
  const isInitialFetchingRef = useRef(false);
  const isLoadingMoreRepliesRef = useRef(false);
  const currentEventIdRef = useRef<string | null>(null);
  const requestGenerationRef = useRef(0);
  const loadMoreAbortControllerRef = useRef<AbortController | null>(null);

  const applyThreadResult = useCallback(
    (result: ThreadResult, source: 'initial' | 'more'): BuiltThreadItems | null => {
      const orderedReplyIds = orderedReplyIdsForThreadResult(result, source, replyOrderRef.current);
      const built = buildThreadItemsFromResult(eventId, result, orderedReplyIds);
      if (!built) return null;

      replyOrderRef.current = built.items
        .filter((item): item is Extract<ThreadItem, { type: 'reply' }> => item.type === 'reply')
        .map((item) => item.event.id);
      threadSeedRef.current = bucketsFromThreadResult(result);
      // Passive convergence: settle any own notes this thread surfaced.
      ingestOwnContent(threadSeedRef.current.allEvents.values(), viewerPubkey);
      profilesRef.current = result.profiles;
      metricsRef.current = result.metrics;
      quotedEventsRef.current = result.quotedEvents;

      const nextHasMore =
        result.hasMoreReplies && (built.expectedReplies === 0 || built.hiddenReplyCount > 0);
      hasMoreRepliesRef.current = nextHasMore;
      setHasMoreReplies(nextHasMore);
      setItems(built.items);
      setHiddenReplyCount(built.hiddenReplyCount);
      setDataVersion((v) => v + 1);

      feedLog.info(source === 'initial' ? 'thread.load.done' : 'thread.replies.load_more.done', {
        eventId,
        parents: result.thread.parents.length,
        replies: built.receivedReplies,
        profiles: result.profiles.size,
        hiddenReplies: built.hiddenReplyCount,
        hasMoreReplies: nextHasMore,
        replyOffset: replyOffsetRef.current,
        replySort,
      });

      return built;
    },
    [eventId, replySort, viewerPubkey]
  );

  const loadMoreReplies = useCallback(async () => {
    if (
      !eventId ||
      isInitialFetchingRef.current ||
      isLoadingMoreRepliesRef.current ||
      !hasMoreRepliesRef.current ||
      !threadSeedRef.current
    ) {
      return;
    }

    const generation = requestGenerationRef.current;
    const offset = replyOffsetRef.current;
    const seed = threadSeedRef.current;
    const controller = new AbortController();
    loadMoreAbortControllerRef.current?.abort();
    loadMoreAbortControllerRef.current = controller;
    isLoadingMoreRepliesRef.current = true;
    setIsLoadingMoreReplies(true);

    const client = getFeedClient();

    feedLog.info('thread.replies.load_more.start', {
      eventId,
      limit: THREAD_REPLY_PAGE_SIZE,
      offset,
      replySort,
    });

    try {
      const result = await client.getThread({
        eventId,
        limit: THREAD_REPLY_PAGE_SIZE,
        offset,
        sort: replySort,
        viewerPubkey,
        seed,
        signal: controller.signal,
      });
      if (generation !== requestGenerationRef.current) return;

      replyOffsetRef.current += result.loadedReplyCount;
      if (result.loadedReplyCount === 0) {
        hasMoreRepliesRef.current = false;
        setHasMoreReplies(false);
        return;
      }

      if (!applyThreadResult(result, 'more')) {
        hasMoreRepliesRef.current = false;
        setHasMoreReplies(false);
      }
    } catch (err) {
      if (generation === requestGenerationRef.current) {
        feedLog.error('thread.replies.load_more.error', {
          eventId,
          replySort,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    } finally {
      if (loadMoreAbortControllerRef.current === controller) {
        loadMoreAbortControllerRef.current = null;
      }
      client.dispose?.();
      if (generation === requestGenerationRef.current) {
        isLoadingMoreRepliesRef.current = false;
        setIsLoadingMoreReplies(false);
      }
    }
  }, [applyThreadResult, eventId, replySort, viewerPubkey]);

  useEffect(() => {
    if (!eventId) return;

    let cancelled = false;
    const preservedSeed = threadSeedRef.current;
    const eventChanged = currentEventIdRef.current !== eventId;
    currentEventIdRef.current = eventId;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    const controller = new AbortController();
    loadMoreAbortControllerRef.current?.abort();
    loadMoreAbortControllerRef.current = null;
    isInitialFetchingRef.current = true;
    isLoadingMoreRepliesRef.current = false;
    replyOffsetRef.current = 0;
    replyOrderRef.current = [];
    threadSeedRef.current = null;
    hasMoreRepliesRef.current = false;
    setError(null);
    setIsFetching(true);
    setIsLoadingMoreReplies(false);
    setHasMoreReplies(false);

    const seed =
      (eventChanged ? consumeThreadSeed(eventId) : (preservedSeed ?? consumeThreadSeed(eventId))) ??
      ownContentSeed(eventId, viewerPubkey);
    if (seed) {
      threadSeedRef.current = seed;
      const seeded = buildThreadItemsFromSeed(eventId, seed);
      if (seeded) {
        replyOrderRef.current = seeded.items
          .filter((item): item is Extract<ThreadItem, { type: 'reply' }> => item.type === 'reply')
          .map((item) => item.event.id);
        profilesRef.current = seed.profiles;
        metricsRef.current = seed.metrics;
        quotedEventsRef.current = seed.quotedEvents;
        setItems(seeded.items);
        setHiddenReplyCount(seeded.hiddenReplyCount);
        setDataVersion((v) => v + 1);
        setIsLoading(false);
        feedLog.info('thread.seed.applied', {
          eventId,
          seedEvents: seed.allEvents.size,
          seedReplyPreviewIds: seed.replyPreviewEventIds?.map((id) => id.slice(0, 10)) ?? [],
          renderedReplies: seeded.receivedReplies,
          hiddenReplies: seeded.hiddenReplyCount,
          expectedReplies: seeded.expectedReplies,
        });
      } else {
        setIsLoading(true);
        feedLog.warn('thread.seed.unusable', {
          eventId,
          seedEvents: seed.allEvents.size,
          seedReplyPreviewIds: seed.replyPreviewEventIds?.map((id) => id.slice(0, 10)) ?? [],
        });
      }
    } else {
      setItems([]);
      setHiddenReplyCount(0);
      setIsLoading(true);
    }

    feedLog.info('thread.load.start', {
      eventId,
      seeded: !!seed,
      replySort,
      viewerPubkey: !!viewerPubkey,
    });

    const fetchThread = async () => {
      const client = getFeedClient();

      try {
        const result = await client.getThread({
          eventId,
          limit: THREAD_REPLY_PAGE_SIZE,
          offset: 0,
          sort: replySort,
          viewerPubkey,
          seed,
          signal: controller.signal,
        });
        if (cancelled || generation !== requestGenerationRef.current) return;
        replyOffsetRef.current = result.loadedReplyCount;

        if (!applyThreadResult(result, 'initial')) {
          // A locally-seeded own note may not be on nagg yet — keep the seeded
          // render instead of clobbering it with a not-found error.
          if (!seed) setError('Post not found');
          setIsLoading(false);
          setIsFetching(false);
          return;
        }

        setIsLoading(false);
        setIsFetching(false);
      } catch (err) {
        if (!cancelled && generation === requestGenerationRef.current) {
          feedLog.error('thread.load.error', {
            eventId,
            replySort,
            error: err instanceof Error ? err : new Error(String(err)),
          });
          if (!seed) {
            setError('Failed to load thread');
            setIsLoading(false);
          }
          setIsFetching(false);
        }
      } finally {
        client.dispose?.();
        if (!cancelled && generation === requestGenerationRef.current) {
          isInitialFetchingRef.current = false;
        }
      }
    };

    const task = InteractionManager.runAfterInteractions(() => {
      void fetchThread();
    });

    return () => {
      cancelled = true;
      if (requestGenerationRef.current === generation) requestGenerationRef.current += 1;
      controller.abort();
      loadMoreAbortControllerRef.current?.abort();
      loadMoreAbortControllerRef.current = null;
      isInitialFetchingRef.current = false;
      isLoadingMoreRepliesRef.current = false;
      task.cancel();
    };
  }, [applyThreadResult, eventId, replySort, viewerPubkey]);

  return {
    items,
    hiddenReplyCount,
    isLoading,
    isFetching,
    isLoadingMoreReplies,
    hasMoreReplies,
    replySort,
    setReplySort,
    error,
    dataVersion,
    profilesRef,
    metricsRef,
    quotedEventsRef,
    loadMoreReplies,
  };
}
