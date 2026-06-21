import { facade } from '@sovranbitcoin/nagg-ts';

import { buildThreadStructure } from '@/features/feed/lib/buildThreadStructure';
import type { FeedEvent, NoteMetrics, ProfileInfo } from '../components/nostr/feedTypes';
import type { ThreadRequest, ThreadResult } from './feedClient';

// Pure shape bridge: facade ResolvedThread → the app's ThreadResult. Used only
// on the cache/relay path (nagg toggled off); the nagg-enabled path keeps the
// GraphQL viewer-ranked thread in naggFeedClient, which the facade's REST nagg
// tier can't reproduce. Dependency-light (facade + feed types + the pure
// buildThreadStructure) so it stays unit-testable.

/** Map the app's 5-way reply sort to the facade's two tiers can serve. The
 *  engagement sorts (likes/zaps/reposts) have no cache/relay equivalent, so they
 *  degrade to relevance — honestly, rather than returning nothing. */
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
    ...(typeof request.timeoutMs === 'number' ? { timeoutMs: request.timeoutMs } : {}),
  };
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
  for (const item of thread.replies) {
    const event = feedItemEvent(item);
    if (!event) continue;
    allEvents.set(event.id, event);
    replyEvents.push(event);
  }

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

  const replyPageEventIds = replyEvents.map((event) => event.id);
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
