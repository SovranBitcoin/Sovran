import { useCallback, useEffect, useMemo } from 'react';
import { NDKEvent, useNDK, useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { EventDeletion, Reaction, Repost } from 'nostr-tools/kinds';
import { popup } from '@/helper/popup';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import type { FeedEvent, NoteMetrics } from 'components/blocks/nostr/shared';
import { useNostrSocialStore } from '@/stores/nostrSocialStore';

type EngagementState = {
  liked: boolean;
  reposted: boolean;
  likePending: boolean;
  repostPending: boolean;
};

export type EngagementViewState = EngagementState;

function normalizeTags(input: unknown): string[][] {
  if (!Array.isArray(input)) return [];
  return input.filter(Array.isArray) as string[][];
}

function getFirstTagValue(tags: string[][], name: string): string | undefined {
  const tag = tags.find((t) => t[0] === name && !!t[1]);
  return tag?.[1];
}

function createdAtOrZero(event: { created_at?: number }) {
  return event.created_at || 0;
}

export function useNostrEngagement(
  events: FeedEvent[],
  getBaseMetrics: (eventId: string) => NoteMetrics
) {
  const { ndk } = useNDK();
  const { keys: nostrKeys } = useNostrKeysContext();

  const likesByEventId = useNostrSocialStore((state) => state.likesByEventId);
  const repostsByEventId = useNostrSocialStore((state) => state.repostsByEventId);
  const optimisticLikesByEventId = useNostrSocialStore((state) => state.optimisticLikesByEventId);
  const optimisticRepostsByEventId = useNostrSocialStore(
    (state) => state.optimisticRepostsByEventId
  );
  const syncLikesFromRelay = useNostrSocialStore((state) => state.syncLikesFromRelay);
  const syncRepostsFromRelay = useNostrSocialStore((state) => state.syncRepostsFromRelay);
  const setLikeOptimistic = useNostrSocialStore((state) => state.setLikeOptimistic);
  const setRepostOptimistic = useNostrSocialStore((state) => state.setRepostOptimistic);
  const clearLikeOptimistic = useNostrSocialStore((state) => state.clearLikeOptimistic);
  const clearRepostOptimistic = useNostrSocialStore((state) => state.clearRepostOptimistic);
  const markRepostDeleted = useNostrSocialStore((state) => state.markRepostDeleted);
  const unmarkRepostDeleted = useNostrSocialStore((state) => state.unmarkRepostDeleted);

  const eventsById = useMemo(() => {
    const map = new Map<string, FeedEvent>();
    for (const event of events) map.set(event.id, event);
    return map;
  }, [events]);
  const eventIds = useMemo(() => Array.from(eventsById.keys()), [eventsById]);

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

  const relayLikes = useMemo(() => {
    const reactionTargetById = new Map<string, string>();
    for (const event of myReactionEvents || []) {
      if (typeof event.id !== 'string') continue;
      if (typeof event.content === 'string' && event.content !== '+') continue;
      const tags = normalizeTags(event.tags);
      const targetId = getFirstTagValue(tags, 'e');
      if (!targetId || !eventsById.has(targetId)) continue;
      reactionTargetById.set(event.id, targetId);
    }

    const deletedReactionEventIds = new Set<string>();
    for (const event of myDeletionEvents || []) {
      const tags = normalizeTags(event.tags);
      const kindTag = getFirstTagValue(tags, 'k');
      if (kindTag !== String(Reaction)) continue;
      const targetEventId = getFirstTagValue(tags, 'e');
      if (targetEventId) deletedReactionEventIds.add(targetEventId);
    }

    const perTarget = new Map<
      string,
      { targetEventId: string; reactionEventId: string; createdAt: number }
    >();
    for (const event of myReactionEvents || []) {
      if (typeof event.id !== 'string') continue;
      if (deletedReactionEventIds.has(event.id)) continue;
      const targetId = reactionTargetById.get(event.id);
      if (!targetId) continue;
      const prev = perTarget.get(targetId);
      const next = {
        targetEventId: targetId,
        reactionEventId: event.id,
        createdAt: createdAtOrZero(event),
      };
      if (!prev || next.createdAt >= prev.createdAt) perTarget.set(targetId, next);
    }
    return Array.from(perTarget.values());
  }, [eventsById, myDeletionEvents, myReactionEvents]);

  const relayReposts = useMemo(() => {
    const repostTargetById = new Map<string, string>();
    for (const event of myRepostEvents || []) {
      if (typeof event.id !== 'string') continue;
      const tags = normalizeTags(event.tags);
      const targetId = getFirstTagValue(tags, 'e');
      if (!targetId || !eventsById.has(targetId)) continue;
      repostTargetById.set(event.id, targetId);
    }

    const deletedRepostEventIds = new Set<string>();
    for (const event of myDeletionEvents || []) {
      const tags = normalizeTags(event.tags);
      const kindTag = getFirstTagValue(tags, 'k');
      if (kindTag !== String(Repost)) continue;
      const targetEventId = getFirstTagValue(tags, 'e');
      if (targetEventId) deletedRepostEventIds.add(targetEventId);
    }

    const perTarget = new Map<
      string,
      { targetEventId: string; repostEventId: string; createdAt: number }
    >();
    for (const event of myRepostEvents || []) {
      if (typeof event.id !== 'string') continue;
      if (deletedRepostEventIds.has(event.id)) continue;
      const targetId = repostTargetById.get(event.id);
      if (!targetId) continue;
      const prev = perTarget.get(targetId);
      const next = {
        targetEventId: targetId,
        repostEventId: event.id,
        createdAt: createdAtOrZero(event),
      };
      if (!prev || next.createdAt >= prev.createdAt) perTarget.set(targetId, next);
    }
    return Array.from(perTarget.values());
  }, [eventsById, myDeletionEvents, myRepostEvents]);

  useEffect(() => {
    if (eventIds.length === 0) return;
    syncLikesFromRelay(eventIds, relayLikes);
    syncRepostsFromRelay(eventIds, relayReposts);
  }, [eventIds, relayLikes, relayReposts, syncLikesFromRelay, syncRepostsFromRelay]);

  useEffect(() => {
    for (const eventId of eventIds) {
      const likeOpt = optimisticLikesByEventId[eventId];
      if (likeOpt && !likeOpt.pending) {
        const baseLiked = !!likesByEventId[eventId];
        const baseCount = getBaseMetrics(eventId).likeCount;
        const expectedCount = likeOpt.expectedCount;
        const countSettled = expectedCount === undefined || baseCount === expectedCount;
        if (baseLiked === likeOpt.value && countSettled) {
          clearLikeOptimistic(eventId);
        }
      }

      const repostOpt = optimisticRepostsByEventId[eventId];
      if (repostOpt && !repostOpt.pending) {
        const baseReposted = !!repostsByEventId[eventId];
        const baseCount = getBaseMetrics(eventId).repostCount;
        const expectedCount = repostOpt.expectedCount;
        const countSettled = expectedCount === undefined || baseCount === expectedCount;
        if (baseReposted === repostOpt.value && countSettled) {
          clearRepostOptimistic(eventId);
        }
      }
    }
  }, [
    clearLikeOptimistic,
    clearRepostOptimistic,
    eventIds,
    getBaseMetrics,
    likesByEventId,
    optimisticLikesByEventId,
    optimisticRepostsByEventId,
    repostsByEventId,
  ]);

  const engagementRevision = useMemo(() => {
    let revision = 0;
    for (const eventId of eventIds) {
      const likeBase = likesByEventId[eventId];
      const repostBase = repostsByEventId[eventId];
      const likeOpt = optimisticLikesByEventId[eventId];
      const repostOpt = optimisticRepostsByEventId[eventId];

      if (likeBase) revision += likeBase.updatedAt || 1;
      if (repostBase) revision += repostBase.updatedAt || 1;
      if (likeOpt) revision += likeOpt.updatedAt || 1;
      if (repostOpt) revision += repostOpt.updatedAt || 1;
    }
    return revision;
  }, [
    eventIds,
    likesByEventId,
    repostsByEventId,
    optimisticLikesByEventId,
    optimisticRepostsByEventId,
  ]);

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

  const toggleLike = useCallback(
    async (target: FeedEvent) => {
      if (!nostrKeys?.pubkey || !ndk) {
        popup({ message: 'Unable to update like right now', type: 'error' });
        return;
      }

      const eventId = target.id;
      const current = getEngagementState(eventId);
      if (current.likePending) return;

      const previous = optimisticLikesByEventId[eventId];
      const nextLiked = !current.liked;
      const displayedLikeCount = getDisplayMetrics(eventId).likeCount;
      const expectedLikeCount = Math.max(0, displayedLikeCount + (nextLiked ? 1 : -1));
      const nextLikeDelta = expectedLikeCount - getBaseMetrics(eventId).likeCount;
      setLikeOptimistic(eventId, {
        value: nextLiked,
        pending: true,
        delta: nextLikeDelta,
        expectedCount: expectedLikeCount,
        relatedEventId: previous?.relatedEventId || likesByEventId[eventId]?.reactionEventId,
      });

      try {
        if (nextLiked) {
          const reactionEvent = new NDKEvent(ndk);
          reactionEvent.kind = Reaction;
          reactionEvent.content = '+';
          reactionEvent.tags = [
            ['e', target.id],
            ['p', target.pubkey],
          ];
          reactionEvent.created_at = Math.floor(Date.now() / 1000);
          await reactionEvent.publish();
          setLikeOptimistic(eventId, {
            value: nextLiked,
            pending: false,
            delta: nextLikeDelta,
            expectedCount: expectedLikeCount,
            relatedEventId: reactionEvent.id,
          });
          return;
        }

        const likeEventId = previous?.relatedEventId || likesByEventId[eventId]?.reactionEventId;
        if (!likeEventId) throw new Error('Like event not found');

        const deleteEvent = new NDKEvent(ndk);
        deleteEvent.kind = EventDeletion;
        deleteEvent.content = 'Deleted by the author';
        deleteEvent.tags = [
          ['e', likeEventId],
          ['k', String(Reaction)],
        ];
        deleteEvent.created_at = Math.floor(Date.now() / 1000);
        await deleteEvent.publish();
        setLikeOptimistic(eventId, {
          value: nextLiked,
          pending: false,
          delta: nextLikeDelta,
          expectedCount: expectedLikeCount,
        });
      } catch {
        if (previous) {
          setLikeOptimistic(eventId, {
            value: previous.value,
            pending: previous.pending,
            delta: previous.delta,
            expectedCount: previous.expectedCount,
            relatedEventId: previous.relatedEventId,
          });
        } else {
          clearLikeOptimistic(eventId);
        }
        popup({ message: 'Failed to update like. Please try again.', type: 'error' });
      }
    },
    [
      clearLikeOptimistic,
      getBaseMetrics,
      getDisplayMetrics,
      getEngagementState,
      likesByEventId,
      ndk,
      nostrKeys?.pubkey,
      optimisticLikesByEventId,
      setLikeOptimistic,
    ]
  );

  const toggleRepost = useCallback(
    async (target: FeedEvent) => {
      if (!nostrKeys?.pubkey || !ndk) {
        popup({ message: 'Unable to update repost right now', type: 'error' });
        return;
      }

      const eventId = target.id;
      const current = getEngagementState(eventId);
      if (current.repostPending) return;

      const previous = optimisticRepostsByEventId[eventId];
      const nextReposted = !current.reposted;
      const displayedRepostCount = getDisplayMetrics(eventId).repostCount;
      const expectedRepostCount = Math.max(0, displayedRepostCount + (nextReposted ? 1 : -1));
      const nextRepostDelta = expectedRepostCount - getBaseMetrics(eventId).repostCount;
      setRepostOptimistic(eventId, {
        value: nextReposted,
        pending: true,
        delta: nextRepostDelta,
        expectedCount: expectedRepostCount,
        relatedEventId: previous?.relatedEventId || repostsByEventId[eventId]?.repostEventId,
      });

      try {
        if (nextReposted) {
          const repostEvent = new NDKEvent(ndk);
          repostEvent.kind = Repost;
          repostEvent.content = JSON.stringify(target);
          repostEvent.tags = [
            ['e', target.id],
            ['p', target.pubkey],
          ];
          repostEvent.created_at = Math.floor(Date.now() / 1000);
          await repostEvent.publish();
          unmarkRepostDeleted(eventId);
          setRepostOptimistic(eventId, {
            value: nextReposted,
            pending: false,
            delta: nextRepostDelta,
            expectedCount: expectedRepostCount,
            relatedEventId: repostEvent.id,
          });
          return;
        }

        const repostEventId = previous?.relatedEventId || repostsByEventId[eventId]?.repostEventId;
        if (!repostEventId) throw new Error('Repost event not found');

        const deleteEvent = new NDKEvent(ndk);
        deleteEvent.kind = EventDeletion;
        deleteEvent.content = 'Deleted by the author';
        deleteEvent.tags = [
          ['e', repostEventId],
          ['k', String(Repost)],
        ];
        deleteEvent.created_at = Math.floor(Date.now() / 1000);
        await deleteEvent.publish();
        markRepostDeleted(eventId);
        setRepostOptimistic(eventId, {
          value: nextReposted,
          pending: false,
          delta: nextRepostDelta,
          expectedCount: expectedRepostCount,
        });
      } catch {
        if (previous) {
          setRepostOptimistic(eventId, {
            value: previous.value,
            pending: previous.pending,
            delta: previous.delta,
            expectedCount: previous.expectedCount,
            relatedEventId: previous.relatedEventId,
          });
        } else {
          clearRepostOptimistic(eventId);
        }
        popup({ message: 'Failed to update repost. Please try again.', type: 'error' });
      }
    },
    [
      clearRepostOptimistic,
      getBaseMetrics,
      getDisplayMetrics,
      getEngagementState,
      markRepostDeleted,
      ndk,
      nostrKeys?.pubkey,
      optimisticRepostsByEventId,
      repostsByEventId,
      setRepostOptimistic,
      unmarkRepostDeleted,
    ]
  );

  return {
    getDisplayMetrics,
    getEngagementState,
    toggleLike,
    toggleRepost,
    engagementRevision,
  };
}
