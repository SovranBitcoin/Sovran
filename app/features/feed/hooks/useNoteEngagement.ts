/**
 * @fileoverview One note's engagement, read by id.
 *
 * The social store keys everything a card shows about the viewer — confirmed
 * like/repost/reply, the optimistic overlays, the zap record — by event id, and
 * replaces a note's entry without touching its neighbours'. So a card
 * subscribes to its own note here and re-renders when that note changes, not
 * when any note does. The `read*` functions are the same derivation without a
 * subscription, for callbacks that need the answer at the moment they run.
 */

import { useMemo } from 'react';

import { useShallow } from 'zustand/shallow';

import type { NoteMetrics } from '@/features/feed/components/nostr/feedTypes';
import { overlayToggleCount, overlayZapSats } from '@/features/feed/lib/engagementOverlay';
import { useNoteStats } from '@/shared/lib/nostr/useEntityCache';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';

export type EngagementViewState = {
  liked: boolean;
  reposted: boolean;
  replied: boolean;
  likePending: boolean;
  repostPending: boolean;
  likePendingDirection?: 'activating' | 'deactivating';
  repostPendingDirection?: 'activating' | 'deactivating';
};

type NoteZapState = { zapped: boolean; zapPending: boolean };

type SocialState = ReturnType<typeof useNostrSocialStore.getState>;

/**
 * The store's say on one note. Flat on purpose: `useShallow` compares one
 * level, and every member is a primitive or an entry the store already holds.
 */
function selectNote(state: SocialState, eventId: string | undefined) {
  const record = eventId ? state.engagementByEventId[eventId] : undefined;
  return {
    confirmedLiked: !!record?.liked,
    confirmedReposted: !!record?.reposted,
    replied: !!record?.replied,
    like: eventId ? state.optimisticLikesByEventId[eventId] : undefined,
    repost: eventId ? state.optimisticRepostsByEventId[eventId] : undefined,
    zap: eventId ? state.optimisticZapsByEventId[eventId] : undefined,
    zappedBefore: eventId ? !!state.zappedByEventId[eventId] : false,
  };
}

type NoteSlice = ReturnType<typeof selectNote>;

const pendingDirection = (overlay: NoteSlice['like']) =>
  overlay?.pending ? (overlay.value ? 'activating' : 'deactivating') : undefined;

function viewState(note: NoteSlice): EngagementViewState {
  return {
    liked: note.like ? note.like.value : note.confirmedLiked,
    reposted: note.repost ? note.repost.value : note.confirmedReposted,
    replied: note.replied,
    likePending: !!note.like?.pending,
    repostPending: !!note.repost?.pending,
    likePendingDirection: pendingDirection(note.like),
    repostPendingDirection: pendingDirection(note.repost),
  };
}

/**
 * Viewer zap state for the lightning button tint. The durable zap record is
 * the authority — the optimistic overlay is cleared once nagg's counts catch
 * up, so tinting off it alone made the highlight vanish at settle time.
 */
function zapState(note: NoteSlice): NoteZapState {
  return {
    zapped: note.zappedBefore || (note.zap?.deltaSats ?? 0) > 0,
    zapPending: !!note.zap?.pending,
  };
}

function displayMetrics(base: NoteMetrics, note: NoteSlice): NoteMetrics {
  return {
    ...base,
    likeCount: overlayToggleCount(base.likeCount, note.like),
    repostCount: overlayToggleCount(base.repostCount, note.repost),
    satsZapped: overlayZapSats(base.satsZapped, note.zap),
  };
}

const readNote = (eventId: string) => selectNote(useNostrSocialStore.getState(), eventId);

/** A note's viewer state as the store holds it right now. */
export const readEngagementState = (eventId: string): EngagementViewState =>
  viewState(readNote(eventId));

/** A note's zap state as the store holds it right now. */
export const readZapState = (eventId: string): NoteZapState => zapState(readNote(eventId));

/** `base` with the viewer's optimistic like, repost and zap laid over it, right now. */
export const readDisplayMetrics = (eventId: string, base: NoteMetrics): NoteMetrics =>
  displayMetrics(base, readNote(eventId));

/**
 * What a card shows for one note, kept current. The base counts come from the
 * entity cache — the one owner every surface lays the overlay over — and fall
 * back to `fallbackMetrics`, the surface's own, for a note the cache has not
 * seen. Each returned object keeps its identity until a value in it changes.
 */
export function useNoteEngagement(
  eventId: string | undefined,
  fallbackMetrics: NoteMetrics
): { metrics: NoteMetrics; state: EngagementViewState; zap: NoteZapState } {
  const note = useNostrSocialStore(useShallow((state: SocialState) => selectNote(state, eventId)));
  const base = useNoteStats(eventId).metrics ?? fallbackMetrics;

  // Keyed on the values, not on `note` or `base`: an overlay gaining its
  // published event id, or a surface handing over an equal counts object, is a
  // new entry with nothing new to show. The identities are the contract — they
  // are what a memoized card and the image overlay compare.
  const { likeCount, repostCount, replyCount, satsZapped } = displayMetrics(base, note);
  const metrics = useMemo(
    () => ({ likeCount, repostCount, replyCount, satsZapped }),
    [likeCount, repostCount, replyCount, satsZapped]
  );

  const {
    liked,
    reposted,
    replied,
    likePending,
    repostPending,
    likePendingDirection,
    repostPendingDirection,
  } = viewState(note);
  const state = useMemo(
    () => ({
      liked,
      reposted,
      replied,
      likePending,
      repostPending,
      likePendingDirection,
      repostPendingDirection,
    }),
    [
      liked,
      reposted,
      replied,
      likePending,
      repostPending,
      likePendingDirection,
      repostPendingDirection,
    ]
  );

  const { zapped, zapPending } = zapState(note);
  const zap = useMemo(() => ({ zapped, zapPending }), [zapped, zapPending]);

  return useMemo(() => ({ metrics, state, zap }), [metrics, state, zap]);
}
