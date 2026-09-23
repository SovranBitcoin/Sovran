import { useCallback, useEffect, useMemo, useRef } from 'react';

import { NDKEvent, useNDK } from '@nostr-dev-kit/ndk-mobile';
import { EventDeletion, Reaction, Repost } from 'nostr-tools/kinds';
import { useShallow } from 'zustand/shallow';

import type { FeedEvent, NoteMetrics } from '@/features/feed/components/nostr/feedTypes';
import {
  overlayToggleCount,
  overlayZapSats,
  shouldSettleToggle,
  shouldSettleZap,
} from '@/features/feed/lib/engagementOverlay';
import { reconcileToggle } from '@/features/feed/lib/engagementToggle';
import {
  feedLog,
  log,
  SHOW_LOGS,
  useQueryResultLogger,
  useWhyDidRender,
} from '@/shared/lib/logger';
import { publishEvent } from '@/shared/lib/nostr/publish';
import { readNoteMetrics } from '@/shared/lib/nostr/useEntityCache';
import { paramPopup } from '@/shared/lib/popup';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';

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

const OPTIMISTIC_STALE_WARN_MS = 30_000;

/** One shared empty array, so "no events" is the same identity every time. */
const EMPTY_EVENT_IDS: readonly string[] = [];

type Ndk = NonNullable<ReturnType<typeof useNDK>['ndk']>;
type ToggleKind = 'like' | 'repost';

// ---------------------------------------------------------------------------
// Toggle machinery — module scope, so the feed, the thread on top of it and
// the image overlay all drive ONE network loop per action.
// ---------------------------------------------------------------------------

/** `like:<id>` / `repost:<id>` actions whose network loop is running. */
const reconcilingActions = new Set<string>();

const actionKey = (kind: ToggleKind, eventId: string) => `${kind}:${eventId}`;

/** The store slice for one action kind, read fresh (never a render snapshot). */
function toggleSlice(kind: ToggleKind) {
  const state = useNostrSocialStore.getState();
  return kind === 'like'
    ? {
        overlays: state.optimisticLikesByEventId,
        setOverlay: state.setLikeOptimistic,
        clearOverlay: state.clearLikeOptimistic,
        confirmedAction: (eventId: string) => state.engagementByEventId[eventId]?.liked,
      }
    : {
        overlays: state.optimisticRepostsByEventId,
        setOverlay: state.setRepostOptimistic,
        clearOverlay: state.clearRepostOptimistic,
        confirmedAction: (eventId: string) => state.engagementByEventId[eventId]?.reposted,
      };
}

/** Update the network-side fields of an overlay without touching the intent. */
function patchOverlay(
  kind: ToggleKind,
  eventId: string,
  patch: { pending?: boolean; relatedEventId?: string | null }
): void {
  const { overlays, setOverlay } = toggleSlice(kind);
  const current = overlays[eventId];
  if (!current) return;
  setOverlay(eventId, {
    value: current.value,
    pending: patch.pending ?? current.pending,
    delta: current.delta,
    expectedCount: current.expectedCount,
    relatedEventId:
      patch.relatedEventId === undefined
        ? current.relatedEventId
        : (patch.relatedEventId ?? undefined),
  });
}

async function publishOwnAction(ndk: Ndk, kind: ToggleKind, target: FeedEvent): Promise<string> {
  const event = new NDKEvent(ndk);
  event.kind = kind === 'like' ? Reaction : Repost;
  event.content = kind === 'like' ? '+' : JSON.stringify(target);
  event.tags = [
    ['e', target.id],
    ['p', target.pubkey],
  ];
  event.created_at = Math.floor(Date.now() / 1000);
  // Reactions are latency-sensitive: settle as soon as one relay accepts.
  const published = await publishEvent({ ndk, event, resolveOn: 'first-ok' });
  if (published.isErr()) throw new Error(`${kind} publish failed`, { cause: published.error });
  if (kind === 'repost') useNostrSocialStore.getState().unmarkRepostDeleted(target.id);
  return event.id;
}

async function retractOwnAction(
  ndk: Ndk,
  kind: ToggleKind,
  target: FeedEvent,
  ownEventId: string
): Promise<void> {
  const deletion = new NDKEvent(ndk);
  deletion.kind = EventDeletion;
  deletion.content = 'Deleted by the author';
  deletion.tags = [
    ['e', ownEventId],
    ['k', String(kind === 'like' ? Reaction : Repost)],
  ];
  deletion.created_at = Math.floor(Date.now() / 1000);
  const deleted = await publishEvent({ ndk, event: deletion, resolveOn: 'first-ok' });
  if (deleted.isErr()) throw new Error(`${kind} delete publish failed`, { cause: deleted.error });
  if (kind === 'repost') useNostrSocialStore.getState().markRepostDeleted(target.id);
}

/** A network step failed: show what the network actually holds. */
function revertToNetwork(
  kind: ToggleKind,
  eventId: string,
  ownEventId: string | undefined,
  baseCount: number
): void {
  const { setOverlay, clearOverlay, confirmedAction } = toggleSlice(kind);
  const networkActive = ownEventId !== undefined;
  if (networkActive === !!confirmedAction(eventId)) {
    clearOverlay(eventId);
    return;
  }
  const expectedCount = networkActive ? baseCount + 1 : Math.max(0, baseCount - 1);
  setOverlay(eventId, {
    value: networkActive,
    pending: false,
    delta: expectedCount - baseCount,
    expectedCount,
    relatedEventId: ownEventId,
  });
}

/** Start converging one action to the viewer's latest intent (no-op if already running). */
function startReconcile(
  ndk: Ndk,
  kind: ToggleKind,
  target: FeedEvent,
  readBaseCount: () => number
): void {
  const key = actionKey(kind, target.id);
  if (reconcilingActions.has(key)) return;
  reconcilingActions.add(key);
  void reconcileToggle({
    initialOwnEventId: toggleSlice(kind).overlays[target.id]?.relatedEventId,
    readIntent: () => toggleSlice(kind).overlays[target.id]?.value,
    activate: () => publishOwnAction(ndk, kind, target),
    deactivate: (ownEventId) => retractOwnAction(ndk, kind, target, ownEventId),
    onProgress: (ownEventId) =>
      patchOverlay(kind, target.id, { relatedEventId: ownEventId ?? null }),
    onSettled: () => {
      reconcilingActions.delete(key);
      patchOverlay(kind, target.id, { pending: false });
    },
    onFailed: (ownEventId, error) => {
      reconcilingActions.delete(key);
      revertToNetwork(kind, target.id, ownEventId, readBaseCount());
      paramPopup('engagement-update-failed', kind, { failure: { service: 'nostr', error } });
    },
  });
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
  const viewerPubkey = nostrKeys?.pubkey;

  // State slices — grouped with useShallow to minimise re-subscriptions. The
  // canonical maps are populated globally by useOwnEventsSync, so this hook only
  // reads them (no per-screen relay subscription) and owns the optimistic toggle.
  const {
    engagementByEventId,
    optimisticLikesByEventId,
    optimisticRepostsByEventId,
    optimisticZapsByEventId,
    zappedByEventId,
  } = useNostrSocialStore(
    useShallow((s) => ({
      engagementByEventId: s.engagementByEventId,
      optimisticLikesByEventId: s.optimisticLikesByEventId,
      optimisticRepostsByEventId: s.optimisticRepostsByEventId,
      optimisticZapsByEventId: s.optimisticZapsByEventId,
      zappedByEventId: s.zappedByEventId,
    }))
  );

  const lastStaleWarningRef = useRef(0);

  // One base for every surface: the entity cache holds the freshest counts any
  // read has ingested for a note, so the feed underneath and the thread on top
  // lay the same overlay over the same numbers. The surface's own map is the
  // fallback for notes the cache has not seen (e.g. mock mode).
  const getSharedBaseMetrics = useCallback(
    (eventId: string): NoteMetrics => readNoteMetrics(eventId) ?? getBaseMetrics(eventId),
    [getBaseMetrics]
  );

  // ---- derived event lookup ----

  const eventsById = useMemo(() => {
    const map = new Map<string, FeedEvent>();
    for (const event of events) map.set(event.id, event);
    return map;
  }, [events]);

  // Identity-stable while the ID SET is unchanged. `events` gets a fresh array
  // on every data-version bump, so deriving straight off `eventsById` handed
  // `engagementRevision` a new `eventIds` each time — measured as
  // `events: 26x new array identity, len 0`, i.e. bumping the revision (and
  // through it every consumer's FlashList `extraData`) for an EMPTY list that
  // had not changed. The joined key is the repo's usual shape for this
  // (`ignoredPubkeysKey` in the feed ignore store).
  const eventIdsKey = useMemo(() => Array.from(eventsById.keys()).join('\u0000'), [eventsById]);
  const eventIds = useMemo(
    () => (eventIdsKey ? eventIdsKey.split('\u0000') : EMPTY_EVENT_IDS),
    [eventIdsKey]
  );

  // ---- settle overlays once the sync catches up; resume orphaned intents ----

  useEffect(() => {
    const { clearLikeOptimistic, clearRepostOptimistic, clearZapOptimistic } =
      useNostrSocialStore.getState();
    const now = Date.now();
    // Collected across the whole pass and emitted once: a feed page settling
    // forty overlays must not cost forty log lines.
    const settles: {
      kind: 'like' | 'repost';
      flipped: boolean;
      confirmed: boolean;
      ageMs: number;
      wasPending: boolean;
    }[] = [];

    for (const [eventId, target] of eventsById) {
      const base = getSharedBaseMetrics(eventId);
      const like = optimisticLikesByEventId[eventId];
      const repost = optimisticRepostsByEventId[eventId];
      const confirmedLiked = !!engagementByEventId[eventId]?.liked;
      const confirmedReposted = !!engagementByEventId[eventId]?.reposted;
      if (shouldSettleToggle(like, confirmedLiked, base.likeCount, now)) {
        // The overlay is coming off, so the control's value is about to become
        // the confirmed one. `flipped` is the case that matters: the confirmed
        // answer DISAGREES with what the user has been looking at — the
        // "already liked it on another client" correction. Nothing logged this,
        // so a control changing under the user was indistinguishable from a
        // normal settle.
        if (SHOW_LOGS)
          settles.push({
            kind: 'like',
            flipped: like.value !== confirmedLiked,
            confirmed: confirmedLiked,
            ageMs: Math.round(now - (like.updatedAt || now)),
            wasPending: !!like.pending,
          });
        clearLikeOptimistic(eventId);
      }
      if (shouldSettleToggle(repost, confirmedReposted, base.repostCount, now)) {
        if (SHOW_LOGS)
          settles.push({
            kind: 'repost',
            flipped: repost.value !== confirmedReposted,
            confirmed: confirmedReposted,
            ageMs: Math.round(now - (repost.updatedAt || now)),
            wasPending: !!repost.pending,
          });
        clearRepostOptimistic(eventId);
      }
      // Zap overlay: clear only when the aggregated 9735 counts have caught
      // up to what we expect. Deliberately NO age-out — an aged-out clear
      // would visibly DECREASE satsZapped when a slow/absent LNURL server
      // never publishes the receipt; the store's recency cap bounds the map.
      if (shouldSettleZap(optimisticZapsByEventId[eventId], base.satsZapped)) {
        clearZapOptimistic(eventId);
      }

      // An intent still pending with no loop running was left by an app close
      // mid-publish (the overlay persists); pick up converging it.
      if (!ndk || !viewerPubkey) continue;
      if (like?.pending && !reconcilingActions.has(actionKey('like', eventId))) {
        startReconcile(ndk, 'like', target, () => getSharedBaseMetrics(eventId).likeCount);
      }
      if (repost?.pending && !reconcilingActions.has(actionKey('repost', eventId))) {
        startReconcile(ndk, 'repost', target, () => getSharedBaseMetrics(eventId).repostCount);
      }
    }

    if (SHOW_LOGS && settles.length > 0) {
      const flipped = settles.filter((entry) => entry.flipped);
      // A flip is a visible correction of an already-painted control, so it
      // escalates; a plain settle is the happy path.
      feedLog[flipped.length > 0 ? 'info' : 'debug']('feed.engagement.settled', {
        settled: settles.length,
        flipped: flipped.length,
        likes: settles.filter((entry) => entry.kind === 'like').length,
        reposts: settles.filter((entry) => entry.kind === 'repost').length,
        stillPending: settles.filter((entry) => entry.wasPending).length,
        maxAgeMs: Math.max(...settles.map((entry) => entry.ageMs)),
        // Which way the corrections went — `confirmed: true` with no local
        // intent is the other-client case.
        flippedToActive: flipped.filter((entry) => entry.confirmed).length,
        flippedToInactive: flipped.filter((entry) => !entry.confirmed).length,
      });
    }
  }, [
    eventsById,
    ndk,
    viewerPubkey,
    // Not read directly: a surface's metrics map changing is the moment fresh
    // counts may have landed in the shared cache, so re-check settlement then.
    getBaseMetrics,
    getSharedBaseMetrics,
    engagementByEventId,
    optimisticLikesByEventId,
    optimisticRepostsByEventId,
    optimisticZapsByEventId,
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
    // The deps are TRIGGERS, not inputs — the body reads none of them, which is
    // why the rule calls them unnecessary. Consumers fold this token into a
    // FlashList `extraData` string, so it must stay a scalar that changes
    // whenever any engagement input does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    eventIds,
    engagementByEventId,
    optimisticLikesByEventId,
    optimisticRepostsByEventId,
    optimisticZapsByEventId,
    zappedByEventId,
  ]);

  // Every consumer folds `engagementRevision` into a FlashList `extraData`
  // string, so ONE bump invalidates every visible row in the feed and the
  // thread. Six independent inputs can cause that bump, and until now nothing
  // said which: a user tapping like, a kind-7 batch landing, and the social
  // store re-keying were indistinguishable while all three redrew the list.
  // Emitted on change only, never per render.
  useWhyDidRender(
    'useNostrEngagement.revision',
    () => ({
      events: eventIds,
      confirmed: engagementByEventId,
      optimisticLikes: optimisticLikesByEventId,
      optimisticReposts: optimisticRepostsByEventId,
      optimisticZaps: optimisticZapsByEventId,
      zapped: zappedByEventId,
    }),
    feedLog
  );
  // Thunk, not an object: those four `Object.keys` walk the whole social store
  // (115 confirmed entries in a measured session) and would run on EVERY render
  // of a shipped build, where the logger is a no-op.
  useQueryResultLogger(
    () => ({
      source: 'useNostrEngagement',
      status: 'ready',
      count: eventIds.length,
      extra: {
        revision: engagementRevision,
        confirmed: Object.keys(engagementByEventId).length,
        pendingLikes: Object.keys(optimisticLikesByEventId).length,
        pendingReposts: Object.keys(optimisticRepostsByEventId).length,
        pendingZaps: Object.keys(optimisticZapsByEventId).length,
        reconciling: reconcilingActions.size,
      },
    }),
    feedLog
  );

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
      const baseMetrics = getSharedBaseMetrics(eventId);
      return {
        ...baseMetrics,
        likeCount: overlayToggleCount(baseMetrics.likeCount, optimisticLikesByEventId[eventId]),
        repostCount: overlayToggleCount(
          baseMetrics.repostCount,
          optimisticRepostsByEventId[eventId]
        ),
        satsZapped: overlayZapSats(baseMetrics.satsZapped, optimisticZapsByEventId[eventId]),
      };
    },
    [
      getSharedBaseMetrics,
      optimisticLikesByEventId,
      optimisticRepostsByEventId,
      optimisticZapsByEventId,
    ]
  );

  /**
   * Viewer zap state for the lightning button tint. The durable
   * `zappedByEventId` record is the authority — the optimistic overlay is
   * cleared once nagg's counts catch up, so tinting off it alone made the
   * highlight vanish at settle time.
   */
  const getZapState = useCallback(
    (eventId: string): { zapped: boolean; zapPending: boolean } => {
      const optZap = optimisticZapsByEventId[eventId];
      return {
        zapped: !!zappedByEventId[eventId] || (optZap?.deltaSats ?? 0) > 0,
        zapPending: !!optZap?.pending,
      };
    },
    [optimisticZapsByEventId, zappedByEventId]
  );

  // ---- toggle actions ----

  /**
   * Flip the viewer's intent now; the network follows. Never blocked by a
   * publish in flight — like then unlike straight away is the loop's job.
   */
  const toggle = useCallback(
    (kind: ToggleKind, target: FeedEvent) => {
      if (!viewerPubkey || !ndk) {
        paramPopup('engagement-update-failed', kind);
        return;
      }
      const eventId = target.id;
      // Read the store, not this render's maps: two taps can land before a re-render.
      const { overlays, setOverlay, confirmedAction } = toggleSlice(kind);
      const overlay = overlays[eventId];
      const confirmed = confirmedAction(eventId);
      const active = overlay ? overlay.value : !!confirmed;
      const relatedEventId = overlay ? overlay.relatedEventId : confirmed?.ownEventId;
      const next = !active;
      if (
        !next &&
        relatedEventId === undefined &&
        !reconcilingActions.has(actionKey(kind, eventId))
      ) {
        // Active from another client with no event id we could retract.
        paramPopup('engagement-update-failed', kind);
        return;
      }
      const readBaseCount = () => {
        const metrics = getSharedBaseMetrics(eventId);
        return kind === 'like' ? metrics.likeCount : metrics.repostCount;
      };
      const baseCount = readBaseCount();
      const expectedCount = Math.max(0, overlayToggleCount(baseCount, overlay) + (next ? 1 : -1));
      setOverlay(eventId, {
        value: next,
        pending: true,
        delta: expectedCount - baseCount,
        expectedCount,
        relatedEventId,
      });
      startReconcile(ndk, kind, target, readBaseCount);
    },
    [getSharedBaseMetrics, ndk, viewerPubkey]
  );

  const toggleLike = useCallback((target: FeedEvent) => toggle('like', target), [toggle]);
  const toggleRepost = useCallback((target: FeedEvent) => toggle('repost', target), [toggle]);

  return {
    getDisplayMetrics,
    getEngagementState,
    getZapState,
    toggleLike,
    toggleRepost,
    engagementRevision,
  };
}
