import { useCallback, useEffect, useMemo, useRef } from 'react';

import { NDKEvent, useNDK } from '@nostr-dev-kit/ndk-mobile';
import { EventDeletion, Reaction, Repost } from 'nostr-tools/kinds';
import { useShallow } from 'zustand/shallow';

import type { FeedEvent, NoteMetrics } from '@/features/feed/components/nostr/feedTypes';
import { log } from '@/shared/lib/logger';
import { publishEvent } from '@/shared/lib/nostr/publish';
import { paramPopup } from '@/shared/lib/popup';
import { useKeyedSingleFlight } from '@/shared/hooks/useSingleFlight';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';

type EngagementState = {
  liked: boolean;
  reposted: boolean;
  replied: boolean;
  likePending: boolean;
  repostPending: boolean;
  likePendingDirection?: 'activating' | 'deactivating';
  repostPendingDirection?: 'activating' | 'deactivating';
};

export type EngagementViewState = EngagementState;

const OPTIMISTIC_SETTLE_GRACE_MS = 15_000;
const OPTIMISTIC_STALE_WARN_MS = 30_000;

// ---------------------------------------------------------------------------
// Generic toggle-engagement helper (deduplicates toggleLike / toggleRepost)
// ---------------------------------------------------------------------------

interface ToggleEngagementOpts {
  target: FeedEvent;
  ndk: NonNullable<ReturnType<typeof useNDK>['ndk']>;
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
      // Reactions are latency-sensitive: settle as soon as one relay accepts.
      const published = await publishEvent({ ndk, event: ndkEvent, resolveOn: 'first-ok' });
      if (published.isErr()) throw new Error(`${label} publish failed`);
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
    const deleted = await publishEvent({ ndk, event: deleteEvent, resolveOn: 'first-ok' });
    if (deleted.isErr()) throw new Error(`${label} delete publish failed`);
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
    paramPopup('engagement-update-failed', label as 'follow' | 'like' | 'repost');
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

  // State slices — grouped with useShallow to minimise re-subscriptions. The
  // canonical maps are populated globally by useOwnEventsSync, so this hook only
  // reads them (no per-screen relay subscription) and owns the optimistic toggle.
  const { engagementByEventId, optimisticLikesByEventId, optimisticRepostsByEventId } =
    useNostrSocialStore(
      useShallow((s) => ({
        engagementByEventId: s.engagementByEventId,
        optimisticLikesByEventId: s.optimisticLikesByEventId,
        optimisticRepostsByEventId: s.optimisticRepostsByEventId,
      }))
    );

  const lastStaleWarningRef = useRef(0);

  // ---- derived event lookup ----

  const eventsById = useMemo(() => {
    const map = new Map<string, FeedEvent>();
    for (const event of events) map.set(event.id, event);
    return map;
  }, [events]);

  const eventIds = useMemo(() => Array.from(eventsById.keys()), [eventsById]);

  // ---- settle optimistic entries when the global sync catches up ----

  useEffect(() => {
    const { clearLikeOptimistic, clearRepostOptimistic } = useNostrSocialStore.getState();

    for (const eventId of eventIds) {
      settleOptimistic(
        optimisticLikesByEventId[eventId],
        !!engagementByEventId[eventId]?.liked,
        getBaseMetrics(eventId).likeCount,
        () => clearLikeOptimistic(eventId)
      );
      settleOptimistic(
        optimisticRepostsByEventId[eventId],
        !!engagementByEventId[eventId]?.reposted,
        getBaseMetrics(eventId).repostCount,
        () => clearRepostOptimistic(eventId)
      );
    }
  }, [
    eventIds,
    getBaseMetrics,
    engagementByEventId,
    optimisticLikesByEventId,
    optimisticRepostsByEventId,
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

  const engagementRevisionRef = useRef(0);
  const engagementRevision = useMemo(() => {
    engagementRevisionRef.current += 1;
    return engagementRevisionRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventIds, engagementByEventId, optimisticLikesByEventId, optimisticRepostsByEventId]);

  // ---- public getters ----

  const getEngagementState = useCallback(
    (eventId: string): EngagementState => {
      const record = engagementByEventId[eventId];
      const baseLiked = !!record?.liked;
      const baseReposted = !!record?.reposted;
      const optLike = optimisticLikesByEventId[eventId];
      const optRepost = optimisticRepostsByEventId[eventId];

      return {
        liked: optLike ? optLike.value : baseLiked,
        reposted: optRepost ? optRepost.value : baseReposted,
        replied: !!record?.replied,
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
    [engagementByEventId, optimisticLikesByEventId, optimisticRepostsByEventId]
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
        paramPopup('engagement-update-failed', 'like');
        return;
      }
      const state = getEngagementState(target.id);
      const { setLikeOptimistic, clearLikeOptimistic } = useNostrSocialStore.getState();
      await toggleEngagement({
        target,
        ndk,
        kind: Reaction,
        currentState: state.liked,
        isPending: state.likePending,
        previousOptimistic: optimisticLikesByEventId[target.id],
        relatedEventIdFromStore: engagementByEventId[target.id]?.liked?.ownEventId,
        displayedCount: getDisplayMetrics(target.id).likeCount,
        baseCount: getBaseMetrics(target.id).likeCount,
        setOptimistic: setLikeOptimistic,
        clearOptimistic: clearLikeOptimistic,
        buildContent: () => '+',
        label: 'like',
      });
    },
    [
      getBaseMetrics,
      getDisplayMetrics,
      getEngagementState,
      engagementByEventId,
      ndk,
      nostrKeys?.pubkey,
      optimisticLikesByEventId,
    ]
  );

  const toggleRepostInner = useCallback(
    async (target: FeedEvent) => {
      if (!nostrKeys?.pubkey || !ndk) {
        paramPopup('engagement-update-failed', 'repost');
        return;
      }
      const state = getEngagementState(target.id);
      const { setRepostOptimistic, clearRepostOptimistic, unmarkRepostDeleted, markRepostDeleted } =
        useNostrSocialStore.getState();
      await toggleEngagement({
        target,
        ndk,
        kind: Repost,
        currentState: state.reposted,
        isPending: state.repostPending,
        previousOptimistic: optimisticRepostsByEventId[target.id],
        relatedEventIdFromStore: engagementByEventId[target.id]?.reposted?.ownEventId,
        displayedCount: getDisplayMetrics(target.id).repostCount,
        baseCount: getBaseMetrics(target.id).repostCount,
        setOptimistic: setRepostOptimistic,
        clearOptimistic: clearRepostOptimistic,
        buildContent: (t) => JSON.stringify(t),
        onActivated: () => unmarkRepostDeleted(target.id),
        onDeactivated: () => markRepostDeleted(target.id),
        label: 'repost',
      });
    },
    [
      getBaseMetrics,
      getDisplayMetrics,
      getEngagementState,
      engagementByEventId,
      ndk,
      nostrKeys?.pubkey,
      optimisticRepostsByEventId,
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
