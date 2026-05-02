import { useCallback, useEffect, useMemo, useRef } from 'react';

import { NDKEvent, useNDK, useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { EventDeletion, Reaction, Repost } from 'nostr-tools/kinds';
import { useShallow } from 'zustand/shallow';

import type { FeedEvent, NoteMetrics } from '@/features/feed/components/nostr/shared';
import { log } from '@/shared/lib/logger';
import { engagementUpdateFailedPopup } from '@/shared/lib/popup';
import { useKeyedSingleFlight } from '@/shared/hooks/useSingleFlight';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';

type EngagementState = {
  liked: boolean;
  reposted: boolean;
  likePending: boolean;
  repostPending: boolean;
  likePendingDirection?: 'activating' | 'deactivating';
  repostPendingDirection?: 'activating' | 'deactivating';
};

export type EngagementViewState = EngagementState;

const OPTIMISTIC_SETTLE_GRACE_MS = 15_000;
const OPTIMISTIC_STALE_WARN_MS = 30_000;

// ---------------------------------------------------------------------------
// Shared Nostr-event tag helpers
// ---------------------------------------------------------------------------

function normalizeTags(input: unknown): string[][] {
  if (!Array.isArray(input)) return [];
  return input.filter(Array.isArray) as string[][];
}

function getFirstTagValue(tags: string[][], name: string): string | undefined {
  const tag = tags.find((t) => t[0] === name && !!t[1]);
  return tag?.[1];
}

// ---------------------------------------------------------------------------
// Generic relay-engagement builder (deduplicates relayLikes / relayReposts)
// ---------------------------------------------------------------------------

interface RelayEngagement {
  targetEventId: string;
  engagementEventId: string;
  createdAt: number;
}

/**
 * Builds a de-duplicated, most-recent-per-target list of relay engagements
 * (likes or reposts) from raw NDK subscription events, after filtering out
 * deletions of the specified `kind`.
 */
function buildRelayEngagements(opts: {
  rawEvents: any[] | undefined;
  deletionEvents: any[] | undefined;
  knownTargets: Map<string, FeedEvent>;
  kind: number;
  contentFilter?: (content: string) => boolean;
}): RelayEngagement[] {
  const { rawEvents, deletionEvents, knownTargets, kind, contentFilter } = opts;

  const targetByEngagementId = new Map<string, string>();
  for (const event of rawEvents || []) {
    if (typeof event.id !== 'string') continue;
    if (contentFilter && typeof event.content === 'string' && !contentFilter(event.content))
      continue;
    const tags = normalizeTags(event.tags);
    const targetId = getFirstTagValue(tags, 'e');
    if (!targetId || !knownTargets.has(targetId)) continue;
    targetByEngagementId.set(event.id, targetId);
  }

  const deletedIds = new Set<string>();
  for (const event of deletionEvents || []) {
    const tags = normalizeTags(event.tags);
    if (getFirstTagValue(tags, 'k') !== String(kind)) continue;
    const eid = getFirstTagValue(tags, 'e');
    if (eid) deletedIds.add(eid);
  }

  const latest = new Map<string, RelayEngagement>();
  for (const event of rawEvents || []) {
    if (typeof event.id !== 'string' || deletedIds.has(event.id)) continue;
    const targetId = targetByEngagementId.get(event.id);
    if (!targetId) continue;
    const candidate: RelayEngagement = {
      targetEventId: targetId,
      engagementEventId: event.id,
      createdAt: event.created_at || 0,
    };
    const prev = latest.get(targetId);
    if (!prev || candidate.createdAt >= prev.createdAt) latest.set(targetId, candidate);
  }

  return Array.from(latest.values());
}

// ---------------------------------------------------------------------------
// Generic toggle-engagement helper (deduplicates toggleLike / toggleRepost)
// ---------------------------------------------------------------------------

interface ToggleEngagementOpts {
  target: FeedEvent;
  ndk: any;
  kind: typeof Reaction | typeof Repost;
  currentState: boolean;
  isPending: boolean;
  previousOptimistic:
    | {
        value: boolean;
        pending: boolean;
        delta: number;
        expectedCount?: number;
        relatedEventId?: string;
      }
    | undefined;
  relatedEventIdFromStore: string | undefined;
  displayedCount: number;
  baseCount: number;
  setOptimistic: (
    eventId: string,
    params: {
      value: boolean;
      pending: boolean;
      delta: number;
      expectedCount?: number;
      relatedEventId?: string;
    }
  ) => void;
  clearOptimistic: (eventId: string) => void;
  buildContent: (target: FeedEvent) => string;
  onActivated?: (eventId: string) => void;
  onDeactivated?: (eventId: string) => void;
  label: string;
}

async function toggleEngagement(opts: ToggleEngagementOpts): Promise<void> {
  const {
    target,
    ndk,
    kind,
    currentState,
    isPending,
    previousOptimistic,
    relatedEventIdFromStore,
    displayedCount,
    baseCount,
    setOptimistic,
    clearOptimistic,
    buildContent,
    onActivated,
    onDeactivated,
    label,
  } = opts;

  const eventId = target.id;
  if (isPending) return;

  const nextActive = !currentState;
  const expectedCount = Math.max(0, displayedCount + (nextActive ? 1 : -1));
  const delta = expectedCount - baseCount;
  const prevRelated = previousOptimistic?.relatedEventId || relatedEventIdFromStore;

  setOptimistic(eventId, {
    value: nextActive,
    pending: true,
    delta,
    expectedCount,
    relatedEventId: prevRelated,
  });

  try {
    if (nextActive) {
      const ndkEvent = new NDKEvent(ndk);
      ndkEvent.kind = kind;
      ndkEvent.content = buildContent(target);
      ndkEvent.tags = [
        ['e', target.id],
        ['p', target.pubkey],
      ];
      ndkEvent.created_at = Math.floor(Date.now() / 1000);
      await ndkEvent.publish();
      onActivated?.(eventId);
      setOptimistic(eventId, {
        value: nextActive,
        pending: false,
        delta,
        expectedCount,
        relatedEventId: ndkEvent.id,
      });
      return;
    }

    if (!prevRelated) throw new Error(`${label} event not found`);

    const deleteEvent = new NDKEvent(ndk);
    deleteEvent.kind = EventDeletion;
    deleteEvent.content = 'Deleted by the author';
    deleteEvent.tags = [
      ['e', prevRelated],
      ['k', String(kind)],
    ];
    deleteEvent.created_at = Math.floor(Date.now() / 1000);
    await deleteEvent.publish();
    onDeactivated?.(eventId);
    setOptimistic(eventId, { value: nextActive, pending: false, delta, expectedCount });
  } catch {
    if (previousOptimistic) {
      setOptimistic(eventId, {
        value: previousOptimistic.value,
        pending: previousOptimistic.pending,
        delta: previousOptimistic.delta,
        expectedCount: previousOptimistic.expectedCount,
        relatedEventId: previousOptimistic.relatedEventId,
      });
    } else {
      clearOptimistic(eventId);
    }
    engagementUpdateFailedPopup(label as 'follow' | 'like' | 'repost');
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useNostrEngagement(
  events: FeedEvent[],
  getBaseMetrics: (eventId: string) => NoteMetrics
) {
  const { ndk } = useNDK();
  const { keys: nostrKeys } = useNostrKeysContext();

  // State slices — grouped with useShallow to minimise re-subscriptions
  const { likesByEventId, repostsByEventId, optimisticLikesByEventId, optimisticRepostsByEventId } =
    useNostrSocialStore(
      useShallow((s) => ({
        likesByEventId: s.likesByEventId,
        repostsByEventId: s.repostsByEventId,
        optimisticLikesByEventId: s.optimisticLikesByEventId,
        optimisticRepostsByEventId: s.optimisticRepostsByEventId,
      }))
    );

  // Actions are stable references — read once from the store, no selector needed
  const actions = useRef(useNostrSocialStore.getState());
  useEffect(() => {
    actions.current = useNostrSocialStore.getState();
  });

  const lastStaleWarningRef = useRef(0);

  // ---- derived event lookup ----

  const eventsById = useMemo(() => {
    const map = new Map<string, FeedEvent>();
    for (const event of events) map.set(event.id, event);
    return map;
  }, [events]);

  const eventIds = useMemo(() => Array.from(eventsById.keys()), [eventsById]);

  // ---- relay subscription filters ----

  const reactionFilters = useMemo(() => {
    if (!nostrKeys?.pubkey || eventIds.length === 0) return null;
    return [{ authors: [nostrKeys.pubkey], kinds: [Reaction], '#e': eventIds, limit: 500 }];
  }, [eventIds, nostrKeys?.pubkey]);

  const repostFilters = useMemo(() => {
    if (!nostrKeys?.pubkey || eventIds.length === 0) return null;
    return [{ authors: [nostrKeys.pubkey], kinds: [Repost], '#e': eventIds, limit: 500 }];
  }, [eventIds, nostrKeys?.pubkey]);

  const deletionFilters = useMemo(() => {
    if (!nostrKeys?.pubkey) return null;
    return [{ authors: [nostrKeys.pubkey], kinds: [EventDeletion], '#k': ['6', '7'], limit: 500 }];
  }, [nostrKeys?.pubkey]);

  const { events: myReactionEvents } = useSubscribe({ filters: reactionFilters });
  const { events: myRepostEvents } = useSubscribe({ filters: repostFilters });
  const { events: myDeletionEvents } = useSubscribe({ filters: deletionFilters });

  // ---- build relay engagements (unified) ----

  const relayLikes = useMemo(
    () =>
      buildRelayEngagements({
        rawEvents: myReactionEvents,
        deletionEvents: myDeletionEvents,
        knownTargets: eventsById,
        kind: Reaction,
        contentFilter: (c) => c === '+' || c === '',
      }),
    [eventsById, myDeletionEvents, myReactionEvents]
  );

  const relayReposts = useMemo(
    () =>
      buildRelayEngagements({
        rawEvents: myRepostEvents,
        deletionEvents: myDeletionEvents,
        knownTargets: eventsById,
        kind: Repost,
      }),
    [eventsById, myDeletionEvents, myRepostEvents]
  );

  // ---- sync relay data into store ----

  useEffect(() => {
    if (eventIds.length === 0) return;
    const { syncLikesFromRelay, syncRepostsFromRelay } = actions.current;

    const likesPayload = relayLikes.map((l) => ({
      targetEventId: l.targetEventId,
      reactionEventId: l.engagementEventId,
      createdAt: l.createdAt,
    }));
    const repostsPayload = relayReposts.map((r) => ({
      targetEventId: r.targetEventId,
      repostEventId: r.engagementEventId,
      createdAt: r.createdAt,
    }));

    syncLikesFromRelay(eventIds, likesPayload);
    syncRepostsFromRelay(eventIds, repostsPayload);
  }, [eventIds, relayLikes, relayReposts]);

  // ---- settle optimistic entries when relay catches up ----

  useEffect(() => {
    const { clearLikeOptimistic, clearRepostOptimistic } = actions.current;

    for (const eventId of eventIds) {
      settleOptimistic(
        optimisticLikesByEventId[eventId],
        !!likesByEventId[eventId],
        getBaseMetrics(eventId).likeCount,
        () => clearLikeOptimistic(eventId)
      );
      settleOptimistic(
        optimisticRepostsByEventId[eventId],
        !!repostsByEventId[eventId],
        getBaseMetrics(eventId).repostCount,
        () => clearRepostOptimistic(eventId)
      );
    }
  }, [
    eventIds,
    getBaseMetrics,
    likesByEventId,
    optimisticLikesByEventId,
    optimisticRepostsByEventId,
    repostsByEventId,
  ]);

  // ---- DEV stale-optimistic warning ----

  useEffect(() => {
    if (!__DEV__) return;
    const now = Date.now();
    if (now - lastStaleWarningRef.current < 10_000) return;

    let staleCount = 0;
    for (const eventId of eventIds) {
      for (const opt of [optimisticLikesByEventId[eventId], optimisticRepostsByEventId[eventId]]) {
        if (opt && now - (opt.updatedAt || 0) >= OPTIMISTIC_STALE_WARN_MS) staleCount++;
      }
    }
    if (staleCount > 0) {
      lastStaleWarningRef.current = now;
      log.warn('feed.engagement.stale_optimistic', { staleCount });
    }
  }, [eventIds, optimisticLikesByEventId, optimisticRepostsByEventId]);

  // ---- engagement revision (for consumer cache-busting) ----

  const engagementRevision = useMemo(() => {
    let revision = 0;
    for (const eventId of eventIds) {
      for (const entry of [
        likesByEventId[eventId],
        repostsByEventId[eventId],
        optimisticLikesByEventId[eventId],
        optimisticRepostsByEventId[eventId],
      ]) {
        if (entry) revision += (entry as { updatedAt?: number }).updatedAt || 1;
      }
    }
    return revision;
  }, [
    eventIds,
    likesByEventId,
    repostsByEventId,
    optimisticLikesByEventId,
    optimisticRepostsByEventId,
  ]);

  // ---- public getters ----

  const getEngagementState = useCallback(
    (eventId: string): EngagementState => {
      const baseLiked = !!likesByEventId[eventId];
      const baseReposted = !!repostsByEventId[eventId];
      const optLike = optimisticLikesByEventId[eventId];
      const optRepost = optimisticRepostsByEventId[eventId];

      return {
        liked: optLike ? optLike.value : baseLiked,
        reposted: optRepost ? optRepost.value : baseReposted,
        likePending: !!optLike?.pending,
        repostPending: !!optRepost?.pending,
        likePendingDirection: optLike?.pending
          ? optLike.value
            ? 'activating'
            : 'deactivating'
          : undefined,
        repostPendingDirection: optRepost?.pending
          ? optRepost.value
            ? 'activating'
            : 'deactivating'
          : undefined,
      };
    },
    [likesByEventId, optimisticLikesByEventId, optimisticRepostsByEventId, repostsByEventId]
  );

  const getDisplayMetrics = useCallback(
    (eventId: string): NoteMetrics => {
      const baseMetrics = getBaseMetrics(eventId);
      const likeDelta = optimisticLikesByEventId[eventId]?.delta ?? 0;
      const repostDelta = optimisticRepostsByEventId[eventId]?.delta ?? 0;
      return {
        ...baseMetrics,
        likeCount: Math.max(0, baseMetrics.likeCount + likeDelta),
        repostCount: Math.max(0, baseMetrics.repostCount + repostDelta),
      };
    },
    [getBaseMetrics, optimisticLikesByEventId, optimisticRepostsByEventId]
  );

  // ---- toggle actions (unified via toggleEngagement) ----

  const toggleLikeInner = useCallback(
    async (target: FeedEvent) => {
      if (!nostrKeys?.pubkey || !ndk) {
        engagementUpdateFailedPopup('like');
        return;
      }
      const state = getEngagementState(target.id);
      await toggleEngagement({
        target,
        ndk,
        kind: Reaction,
        currentState: state.liked,
        isPending: state.likePending,
        previousOptimistic: optimisticLikesByEventId[target.id],
        relatedEventIdFromStore: likesByEventId[target.id]?.reactionEventId,
        displayedCount: getDisplayMetrics(target.id).likeCount,
        baseCount: getBaseMetrics(target.id).likeCount,
        setOptimistic: actions.current.setLikeOptimistic,
        clearOptimistic: actions.current.clearLikeOptimistic,
        buildContent: () => '+',
        label: 'like',
      });
    },
    [
      getBaseMetrics,
      getDisplayMetrics,
      getEngagementState,
      likesByEventId,
      ndk,
      nostrKeys?.pubkey,
      optimisticLikesByEventId,
    ]
  );

  const toggleRepostInner = useCallback(
    async (target: FeedEvent) => {
      if (!nostrKeys?.pubkey || !ndk) {
        engagementUpdateFailedPopup('repost');
        return;
      }
      const state = getEngagementState(target.id);
      await toggleEngagement({
        target,
        ndk,
        kind: Repost,
        currentState: state.reposted,
        isPending: state.repostPending,
        previousOptimistic: optimisticRepostsByEventId[target.id],
        relatedEventIdFromStore: repostsByEventId[target.id]?.repostEventId,
        displayedCount: getDisplayMetrics(target.id).repostCount,
        baseCount: getBaseMetrics(target.id).repostCount,
        setOptimistic: actions.current.setRepostOptimistic,
        clearOptimistic: actions.current.clearRepostOptimistic,
        buildContent: (t) => JSON.stringify(t),
        onActivated: () => actions.current.unmarkRepostDeleted(target.id),
        onDeactivated: () => actions.current.markRepostDeleted(target.id),
        label: 'repost',
      });
    },
    [
      getBaseMetrics,
      getDisplayMetrics,
      getEngagementState,
      ndk,
      nostrKeys?.pubkey,
      optimisticRepostsByEventId,
      repostsByEventId,
    ]
  );

  // Per-target single-flight: tapping like on post A while post B is still
  // publishing must not block — use the target id as the key so concurrent
  // calls on different posts run in parallel, but a rapid double-tap on the
  // same post drops the duplicate before the second `ndkEvent.publish()`
  // can stomp the first call's optimistic state.
  const targetKey = useCallback((target: FeedEvent) => target.id, []);
  const toggleLike = useKeyedSingleFlight(toggleLikeInner, targetKey);
  const toggleRepost = useKeyedSingleFlight(toggleRepostInner, targetKey);

  return {
    getDisplayMetrics,
    getEngagementState,
    toggleLike,
    toggleRepost,
    engagementRevision,
  };
}

// ---------------------------------------------------------------------------
// Optimistic settlement helper
// ---------------------------------------------------------------------------

function settleOptimistic(
  opt: { value: boolean; pending: boolean; expectedCount?: number; updatedAt?: number } | undefined,
  baseValue: boolean,
  baseCount: number,
  clear: () => void
) {
  if (!opt || opt.pending) return;
  const countSettled = opt.expectedCount === undefined || baseCount === opt.expectedCount;
  const isAgedOut = Date.now() - (opt.updatedAt || 0) >= OPTIMISTIC_SETTLE_GRACE_MS;
  if (baseValue === opt.value && (countSettled || isAgedOut)) clear();
}
