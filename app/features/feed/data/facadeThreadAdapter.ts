import { facade } from 'nostr';

import { buildThreadStructure } from '@/features/feed/lib/buildThreadStructure';
import type { FeedEvent, NoteMetrics, ProfileInfo } from '../components/nostr/feedTypes';
import { recordDebugTiers } from '@/shared/stores/runtime/debugTierStore';
import type { ThreadRequest, ThreadResult } from './feedClient';

// Pure shape bridge: facade ResolvedThread → the app's ThreadResult. Used only
// on the cache/relay path (nagg toggled off); the nagg-enabled path keeps the
// GraphQL viewer-ranked thread in naggFeedClient, which the facade's REST nagg
// tier can't reproduce. Dependency-light (facade + feed types + the pure
// buildThreadStructure) so it stays unit-testable.

// Per-tier budget for a facade thread fetch. Lower than the facade's 30s default
// so a Primal→relay fall-through (when Primal lacks the note) can't hold the
// thread skeleton for a full minute before settling to "no replies".
const THREAD_TIER_TIMEOUT_MS = 12_000;

/** Map the app's 5-way reply sort to what the facade tiers serve natively.
 *  Primal's thread_view has NO server sort param (the client post-sorts), so we
 *  fetch in relevance/new order and post-sort engagement modes below. */
function toFacadeSort(sort: ThreadRequest['sort']): facade.ThreadSort {
  return sort === 'new' ? 'new' : 'relevant';
}

export function toFacadeThreadRequest(request: ThreadRequest): facade.ThreadRequest {
  return {
    noteId: request.eventId,
    sort: toFacadeSort(request.sort),
    ...(request.viewerPubkey ? { viewerPubkey: request.viewerPubkey } : {}),
    ...(typeof request.limit === 'number' ? { limit: request.limit } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
    timeoutMs: request.timeoutMs ?? THREAD_TIER_TIMEOUT_MS,
  };
}

type ReplyStat = {
  likes: number;
  reposts: number;
  replies: number;
  zaps: number;
  satsZapped: number;
};
const ZERO_STAT: ReplyStat = { likes: 0, reposts: 0, replies: 0, zaps: 0, satsZapped: 0 };

/**
 * Post-sort reply ids to approximate the app's 5 sort modes against the bundled
 * per-note stats — Primal's cache has no server-side reply sort, so (like the
 * Primal clients) we sort locally. The UI renders replies in replyPageEventIds
 * order, so this ordering is what the sort tabs actually change.
 */
function sortedReplyIds(
  events: readonly FeedEvent[],
  stats: Record<string, ReplyStat>,
  sort: ThreadRequest['sort']
): string[] {
  const stat = (id: string): ReplyStat => stats[id] ?? ZERO_STAT;
  const recency = (event: FeedEvent): number => event.created_at ?? 0;
  const score = (event: FeedEvent): number => {
    const s = stat(event.id);
    switch (sort) {
      case 'new':
        return recency(event);
      case 'likes':
        return s.likes;
      case 'zaps':
        return s.satsZapped;
      case 'reposts':
        return s.reposts;
      case 'relevant':
      default:
        // No cache relevance score is bundled, so approximate "top" replies by
        // weighted engagement; recency breaks ties.
        return s.likes + s.reposts * 2 + s.replies;
    }
  };
  return [...events]
    .sort((a, b) => score(b) - score(a) || recency(b) - recency(a))
    .map((event) => event.id);
}

function feedItemEvent(item: facade.FeedItem): FeedEvent | undefined {
  return (item.type === 'note' ? item.event : (item.originalEvent ?? item.repostEvent)) as
    | FeedEvent
    | undefined;
}

export function resolvedThreadToResult(
  thread: facade.ResolvedThread,
  request: ThreadRequest
): ThreadResult {
  const allEvents = new Map<string, FeedEvent>();
  const replyEvents: FeedEvent[] = [];

  const root = feedItemEvent(thread.root);
  if (root) allEvents.set(root.id, root);
  // Ancestors go into allEvents (NOT the reply list) so buildThreadStructure
  // renders the parent chain — the relay/primal floor now fetches it.
  for (const item of thread.parents) {
    const event = feedItemEvent(item);
    if (event) allEvents.set(event.id, event);
  }
  for (const item of thread.replies) {
    const event = feedItemEvent(item);
    if (!event) continue;
    allEvents.set(event.id, event);
    replyEvents.push(event);
  }

  // Dev-only: stamp every note in the thread (root + parents + replies) with the
  // tier that served it so PostCard can badge its source. No-op in production.
  if (__DEV__) recordDebugTiers([...allEvents.keys()], thread.tier);

  const quotedEvents = new Map<string, FeedEvent>(
    Object.entries(thread.quoted) as [string, FeedEvent][]
  );
  const profiles = new Map<string, ProfileInfo>(
    Object.entries(thread.profiles).map(([pk, p]) => [
      pk,
      { name: p.name, ...(p.picture ? { picture: p.picture } : {}) },
    ])
  );
  const metrics = new Map<string, NoteMetrics>();
  for (const [id, s] of Object.entries(thread.stats)) {
    metrics.set(id, {
      likeCount: s.likes,
      repostCount: s.reposts,
      replyCount: s.replies,
      satsZapped: s.satsZapped,
    });
  }

  const replyPageEventIds = sortedReplyIds(
    replyEvents,
    thread.stats as Record<string, ReplyStat>,
    request.sort
  );
  return {
    allEvents,
    profiles,
    metrics,
    quotedEvents,
    // The tier returned the whole thread already ordered by its manifest, so the
    // pure tree-builder arranges parents/replies; there's no separate page merge.
    thread: buildThreadStructure(request.eventId, allEvents),
    replyPageEventIds,
    replyPageSize: request.limit ?? replyEvents.length,
    loadedReplyCount: replyEvents.length,
    // Primal/relay return the full thread in one shot (cursor null) → no paging.
    hasMoreReplies: thread.cursor !== null,
  };
}

/** Empty result when every enabled tier is exhausted — keeps the thread screen
 *  honest (shows "no replies") rather than silently using nagg behind a toggle. */
export function emptyThreadResult(request: ThreadRequest): ThreadResult {
  return {
    allEvents: new Map(),
    profiles: new Map(),
    metrics: new Map(),
    quotedEvents: new Map(),
    thread: buildThreadStructure(request.eventId, new Map()),
    replyPageEventIds: [],
    replyPageSize: request.limit ?? 0,
    loadedReplyCount: 0,
    hasMoreReplies: false,
  };
}
