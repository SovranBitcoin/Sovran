import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';
import { facade } from 'nostr';
import type { NostrTier } from '@sovranbitcoin/schemas';

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
import { consumeThreadSeed } from '@/features/feed/lib/threadSeedCache';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import {
  bucketsFromThreadResult,
  buildThreadItemsFromResult,
  buildThreadItemsFromSeed,
  composeThreadItems,
  orderedReplyIdsForThreadResult,
  type BuiltThreadItems,
  type ThreadItem,
} from '@/features/feed/lib/threadItems';
import { useFeedIgnoreStore } from '@/features/feed/stores/ignoreStore';
import { feedLog } from '@/shared/lib/logger';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { ingestOwnContent, useOwnContentStore } from '@/shared/stores/profile/ownContentStore';
import { ingestOwnMediaBlobs } from '@/shared/stores/profile/ownedMediaStore';

/**
 * Build a single-note thread seed from a locally-stored own note, so a just-
 * posted (or other-client) note opens its thread instantly even before it has
 * round-tripped through relays/nagg. Scoped to the active viewer.
 */
function ownContentSeed(
  eventId: string,
  viewerPubkey: string | undefined
): ThreadSeedBuckets | undefined {
  const entry = useOwnContentStore.getState().getOwn(eventId, viewerPubkey);
  if (!entry) return undefined;
  return {
    allEvents: new Map([[eventId, entry.event]]),
    profiles: new Map(),
    metrics: new Map(),
    quotedEvents: new Map(),
  };
}

/**
 * First-frame seed projected from the shared nagg-ts entity cache (populated by
 * every feed/notifications read). When the tapped note was already seen, this
 * paints the post + its cached ancestor chain + author profiles/metrics with NO
 * network. It carries the post + its cached ancestor chain + cached direct reply
 * previews + author profiles/metrics, fully replacing the old transient nav
 * snapshot. Returns undefined when the tapped note isn't cached (e.g. a cold deep
 * link), so the network fetch drives the first frame instead.
 */
function cachedThreadSeed(eventId: string): ThreadSeedBuckets | undefined {
  const layer = buildNostrDataLayer();
  if (!layer) return undefined;
  const view = layer.readThread(eventId);
  if (!view.root) return undefined; // not cached — no instant frame available

  const allEvents = new Map<string, FeedEvent>();
  allEvents.set(view.root.id, view.root);
  for (const note of view.relatedNotes) allEvents.set(note.id, note);

  const metrics = new Map<string, NoteMetrics>();
  for (const [id, stats] of Object.entries(view.stats)) {
    metrics.set(id, {
      likeCount: stats.likes,
      repostCount: stats.reposts,
      replyCount: stats.replies,
      satsZapped: stats.satsZapped,
    });
  }

  return {
    allEvents,
    profiles: new Map<string, ProfileInfo>(Object.entries(view.profiles)),
    metrics,
    quotedEvents: new Map<string, FeedEvent>(Object.entries(view.quoted)),
  };
}

export type { ThreadItem } from '@/features/feed/lib/threadItems';

type UseThreadResult = {
  items: ThreadItem[];
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
const THREAD_AUDIT_TIMEOUT_MS = 8_000;
const EMPTY_PROFILES: Map<string, ProfileInfo> = new Map();
const EMPTY_METRICS: Map<string, NoteMetrics> = new Map();
const EMPTY_QUOTED: Map<string, FeedEvent> = new Map();

function mergeIntoRef<K, V>(ref: React.MutableRefObject<Map<K, V>>, incoming: Map<K, V>): void {
  if (ref.current.size === 0) {
    ref.current = incoming;
    return;
  }
  const merged = new Map(ref.current);
  for (const [key, value] of incoming) merged.set(key, value);
  ref.current = merged;
}

export function useThread(eventId: string): UseThreadResult {
  const { keys: nostrKeys } = useNostrKeysContext();
  const viewerPubkey = nostrKeys?.pubkey;
  const [baseItems, setBaseItems] = useState<ThreadItem[]>([]);
  const [spamReplies, setSpamReplies] = useState<FeedEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [isLoadingMoreReplies, setIsLoadingMoreReplies] = useState(false);
  const [hasMoreReplies, setHasMoreReplies] = useState(false);
  const [replySort, setReplySort] = useState<ThreadReplySort>('relevant');
  const [error, setError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const ignoredPubkeys = useFeedIgnoreStore((s) => s.ignoredPubkeys);
  const ignoredEventIds = useFeedIgnoreStore((s) => s.ignoredEventIds);

  const profilesRef = useRef<Map<string, ProfileInfo>>(EMPTY_PROFILES);
  const metricsRef = useRef<Map<string, NoteMetrics>>(EMPTY_METRICS);
  const quotedEventsRef = useRef<Map<string, FeedEvent>>(EMPTY_QUOTED);
  const threadSeedRef = useRef<ThreadSeedBuckets | null>(null);
  const replyOrderRef = useRef<string[]>([]);
  const replyOffsetRef = useRef(0);
  const hasMoreRepliesRef = useRef(false);
  const knownReplyIdsRef = useRef<Set<string>>(new Set());
  const primaryTierRef = useRef<NostrTier | null>(null);
  const spamAuditStartedRef = useRef(false);
  /** Full locally-sorted order from a single-shot source — load-more pages this
   *  from memory instead of the network. Null on the nagg (server-paged) path. */
  const allSortedReplyIdsRef = useRef<string[] | null>(null);
  const isInitialFetchingRef = useRef(false);
  const isLoadingMoreRepliesRef = useRef(false);
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
      ingestOwnMediaBlobs(threadSeedRef.current.allEvents.values(), viewerPubkey);
      // Merge (not replace): audit-supplied hydration must survive later pages.
      mergeIntoRef(profilesRef, result.profiles);
      mergeIntoRef(metricsRef, result.metrics);
      mergeIntoRef(quotedEventsRef, result.quotedEvents);

      if (source === 'initial') {
        primaryTierRef.current = result.tier;
        allSortedReplyIdsRef.current = result.allSortedReplyIds ?? null;
      }
      for (const id of result.knownReplyIds) knownReplyIdsRef.current.add(id);
      for (const id of replyOrderRef.current) knownReplyIdsRef.current.add(id);
      // A later page can acknowledge a reply the audit had flagged — unflag it.
      setSpamReplies((prev) =>
        prev.length > 0 ? prev.filter((event) => !knownReplyIdsRef.current.has(event.id)) : prev
      );

      hasMoreRepliesRef.current = result.hasMoreReplies;
      setHasMoreReplies(result.hasMoreReplies);
      setBaseItems(built.items);
      setDataVersion((v) => v + 1);

      feedLog.info(source === 'initial' ? 'thread.load.done' : 'thread.replies.load_more.done', {
        eventId,
        parents: result.thread.parents.length,
        replies: built.receivedReplies,
        profiles: result.profiles.size,
        tier: result.tier,
        hasMoreReplies: result.hasMoreReplies,
        knownReplies: knownReplyIdsRef.current.size,
        replyOffset: replyOffsetRef.current,
        replySort,
      });

      return built;
    },
    [eventId, replySort, viewerPubkey]
  );

  /** Rebuild the reply tail of baseItems from replyOrderRef + the seed events. */
  const rebuildRepliesFromOrder = useCallback(() => {
    const seedEvents = threadSeedRef.current?.allEvents;
    if (!seedEvents) return;
    setBaseItems((prev) => {
      const head = prev.filter((item) => item.type === 'parent' || item.type === 'target');
      const replies = replyOrderRef.current
        .map((id) => seedEvents.get(id))
        .filter((event): event is FeedEvent => !!event)
        .map<ThreadItem>((event) => ({ type: 'reply', event }));
      return [...head, ...replies];
    });
    setDataVersion((v) => v + 1);
  }, []);

  /**
   * Background "Might be spam" second opinion. Runs once per thread open when
   * nagg served the primary list: Primal→relays are consulted below it, their
   * direct replies diffed against everything nagg acknowledged. OP-authored
   * finds are promoted into the main list's OP block (nagg's ingest cap can
   * drop legit OP replies); the rest render under the spam separator — which
   * ThreadView shows only after the primary list is exhausted.
   */
  const runSpamAudit = useCallback(
    async (result: ThreadResult, generation: number) => {
      if (result.tier !== 'nagg' || spamAuditStartedRef.current) {
        if (result.tier && result.tier !== 'nagg') {
          feedLog.info('thread.spam.skipped', {
            eventId,
            reason: 'primary_tier',
            tier: result.tier,
          });
        }
        return;
      }
      const opPubkey = result.thread.target?.pubkey;
      if (!opPubkey) return;
      spamAuditStartedRef.current = true;

      const layer = buildNostrDataLayer();
      if (!layer) return;
      feedLog.info('thread.spam.start', { eventId, known: knownReplyIdsRef.current.size });
      try {
        // Deliberately unsignalled: the layer memoizes this promise (~5 min), so
        // aborting on unmount would poison the shared entry. Staleness is handled
        // by the generation guard below instead.
        const audit = await layer.auditThreadReplies({
          noteId: eventId,
          opPubkey,
          primaryTier: 'nagg',
          knownReplyIds: [...knownReplyIdsRef.current],
          timeoutMs: THREAD_AUDIT_TIMEOUT_MS,
        });
        if (generation !== requestGenerationRef.current) return;

        const toEvent = (item: facade.FeedItem): FeedEvent | undefined =>
          item.type === 'note' ? (item.event as FeedEvent) : undefined;

        // Merge audit hydration so promoted/spam cards render names/metrics.
        const profiles = new Map<string, ProfileInfo>(
          Object.entries(audit.profiles).map(([pk, p]) => [
            pk,
            { name: p.name, ...(p.picture ? { picture: p.picture } : {}) },
          ])
        );
        const metrics = new Map<string, NoteMetrics>();
        for (const [id, s] of Object.entries(audit.stats)) {
          metrics.set(id, {
            likeCount: s.likes,
            repostCount: s.reposts,
            replyCount: s.replies,
            satsZapped: s.satsZapped,
          });
        }
        mergeIntoRef(profilesRef, profiles);
        mergeIntoRef(metricsRef, metrics);

        // Promote OP-authored finds into the OP block: after the leading run of
        // OP direct replies, before everyone else's.
        const opEvents = audit.opExtras
          .map(toEvent)
          .filter(
            (event): event is FeedEvent => !!event && !knownReplyIdsRef.current.has(event.id)
          );
        if (opEvents.length > 0 && threadSeedRef.current) {
          for (const event of opEvents) {
            threadSeedRef.current.allEvents.set(event.id, event);
            knownReplyIdsRef.current.add(event.id);
          }
          const seedEvents = threadSeedRef.current.allEvents;
          const isOpDirect = (id: string): boolean => {
            const event = seedEvents.get(id);
            return !!event && event.pubkey === opPubkey && facade.isDirectReplyTo(event, eventId);
          };
          let opBlockEnd = 0;
          while (
            opBlockEnd < replyOrderRef.current.length &&
            isOpDirect(replyOrderRef.current[opBlockEnd])
          ) {
            opBlockEnd += 1;
          }
          replyOrderRef.current = [
            ...replyOrderRef.current.slice(0, opBlockEnd),
            ...opEvents.map((event) => event.id),
            ...replyOrderRef.current.slice(opBlockEnd),
          ];
          rebuildRepliesFromOrder();
        }

        const spamEvents = audit.extras
          .map(toEvent)
          .filter(
            (event): event is FeedEvent => !!event && !knownReplyIdsRef.current.has(event.id)
          );
        setSpamReplies(spamEvents);
        if (spamEvents.length > 0) setDataVersion((v) => v + 1);

        feedLog.info('thread.spam.done', {
          eventId,
          tier: audit.tier,
          spam: spamEvents.length,
          promotedOp: opEvents.length,
        });
      } catch (err) {
        feedLog.warn('thread.spam.error', {
          eventId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [eventId, rebuildRepliesFromOrder]
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

    // Single-shot source (Primal/relay): the full sorted order is already in
    // memory — widen the window, no network.
    const allSorted = allSortedReplyIdsRef.current;
    if (allSorted) {
      const shown = replyOrderRef.current.length;
      const next = allSorted.slice(shown, shown + THREAD_REPLY_PAGE_SIZE);
      replyOrderRef.current = [...replyOrderRef.current, ...next];
      for (const id of next) knownReplyIdsRef.current.add(id);
      const exhausted = replyOrderRef.current.length >= allSorted.length;
      hasMoreRepliesRef.current = !exhausted;
      setHasMoreReplies(!exhausted);
      rebuildRepliesFromOrder();
      feedLog.info('thread.replies.load_more.done', {
        eventId,
        replies: next.length,
        fromMemory: true,
        hasMoreReplies: !exhausted,
        replySort,
      });
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
  }, [applyThreadResult, eventId, rebuildRepliesFromOrder, replySort, viewerPubkey]);

  useEffect(() => {
    if (!eventId) return;

    let cancelled = false;
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
    knownReplyIdsRef.current = new Set();
    primaryTierRef.current = null;
    spamAuditStartedRef.current = false;
    allSortedReplyIdsRef.current = null;
    setSpamReplies([]);
    setError(null);
    setIsFetching(true);
    setIsLoadingMoreReplies(false);
    setHasMoreReplies(false);

    // Cache first (authoritative, complete via readThread's ancestor walk + reply
    // scan); the transient nav snapshot is a safety net for anything not yet
    // ingested; own-content covers a just-posted note not yet round-tripped.
    const seed =
      cachedThreadSeed(eventId) ??
      consumeThreadSeed(eventId) ??
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
        setBaseItems(seeded.items);
        setDataVersion((v) => v + 1);
        setIsLoading(false);
        feedLog.info('thread.seed.applied', {
          eventId,
          seedEvents: seed.allEvents.size,
          seedReplyPreviewIds: seed.replyPreviewEventIds?.map((id) => id.slice(0, 10)) ?? [],
          renderedReplies: seeded.receivedReplies,
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
      setBaseItems([]);
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
        // Primary painted — the second opinion runs quietly behind it.
        void runSpamAudit(result, generation);
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
  }, [applyThreadResult, eventId, replySort, runSpamAudit, viewerPubkey]);

  // Final composition: ignore filters over replies AND the spam bucket, and the
  // "Might be spam" section appears only once the primary list is exhausted.
  const items = useMemo(
    () =>
      composeThreadItems(
        baseItems,
        spamReplies,
        { pubkeys: new Set(ignoredPubkeys), eventIds: new Set(ignoredEventIds) },
        { includeSpam: !hasMoreReplies }
      ),
    [baseItems, spamReplies, ignoredPubkeys, ignoredEventIds, hasMoreReplies]
  );

  return {
    items,
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
