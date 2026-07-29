import { facade } from 'nostr';

import { buildThreadStructure } from '@/features/feed/lib/buildThreadStructure';
import type { FeedEvent, NoteMetrics, ProfileInfo } from '../components/nostr/feedTypes';
import { recordDebugTiers } from '@/shared/stores/runtime/debugTierStore';
import type { ThreadRequest, ThreadResult } from './feedClient';

// Pure shape bridge: facade ResolvedThread → the app's ThreadResult, for every
// tier. nagg serves a server-windowed ranked page (its manifest order is
// authoritative — no client post-sort); Primal/relay serve the full thread in
// one shot, so the reply order is computed locally and paged as a window over
// memory. Dependency-light (facade + feed types + the pure buildThreadStructure)
// so it stays unit-testable.

// Per-tier budget for a facade thread fetch. Lower than the facade's 30s default
// so a Primal→relay fall-through (when Primal lacks the note) can't hold the
// thread skeleton for a full minute before settling to "no replies".
const THREAD_TIER_TIMEOUT_MS = 12_000;

/** Map the app's 5-way reply sort onto the facade's server sorts: the
 *  engagement tabs (likes/zaps/reposts) all collapse to nagg's `ranked`;
 *  Primal/relay have no server sort and are post-sorted locally below. */
function toFacadeSort(sort: ThreadRequest['sort']): facade.ThreadSort {
  if (sort === 'new') return 'new';
  if (sort === 'likes' || sort === 'zaps' || sort === 'reposts') return 'ranked';
  return 'relevant';
}

export function toFacadeThreadRequest(request: ThreadRequest): facade.ThreadRequest {
  return {
    noteId: request.eventId,
    sort: toFacadeSort(request.sort),
    ...(request.viewerPubkey ? { viewerPubkey: request.viewerPubkey } : {}),
    offset: request.offset ?? 0,
    // replyLimit 0 = the FULL ordered manifest from `offset`. nagg ships every
    // hydrated event regardless of the manifest window, so this costs the same
    // bytes as a 10-reply page — and the client fake-paginates the stack from
    // memory, so scrolling (and reaching the spam section) never waits on the
    // network. request.limit stays the DISPLAY window size only.
    replyLimit: 0,
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
  // Seed first, network overlay second — a just-posted own note (not yet on any
  // tier) keeps rendering, and fresher network entities win on id collision.
  const allEvents = request.seed ? new Map(request.seed.allEvents) : new Map<string, FeedEvent>();
  const profiles = request.seed ? new Map(request.seed.profiles) : new Map<string, ProfileInfo>();
  const metrics = request.seed ? new Map(request.seed.metrics) : new Map<string, NoteMetrics>();
  const quotedEvents = request.seed
    ? new Map(request.seed.quotedEvents)
    : new Map<string, FeedEvent>();
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
  // Off-manifest hydration (off-page descendants, quote context): available for
  // tap-through and tree context, never in the reply page order.
  for (const item of thread.extras) {
    const event = feedItemEvent(item);
    if (event) allEvents.set(event.id, event);
  }

  // Dev-only: stamp every note in the thread (root + parents + replies) with the
  // tier that served it so PostCard can badge its source. No-op in production.
  if (__DEV__) recordDebugTiers([...allEvents.keys()], thread.tier);

  for (const [id, quoted] of Object.entries(thread.quoted)) {
    quotedEvents.set(id, quoted as FeedEvent);
  }
  for (const [pk, p] of Object.entries(thread.profiles)) {
    profiles.set(pk, { name: p.name, ...(p.picture ? { picture: p.picture } : {}) });
  }
  for (const [id, s] of Object.entries(thread.stats)) {
    metrics.set(id, {
      likeCount: s.likes,
      repostCount: s.reposts,
      replyCount: s.replies,
      satsZapped: s.satsZapped,
    });
  }

  const pageSize = request.limit ?? replyEvents.length;

  // Every source is a single fetch feeding a MEMORY STACK the hook
  // fake-paginates. nagg: the full server manifest (relevant = OP direct
  // replies pinned) is the authoritative order — post-sorting it would be
  // exactly the reshuffle the ordering-manifest rules exist to prevent; a
  // server continuation (thread.hasMore, fetch cap exceeded) is surfaced so
  // the hook can extend the stack over the network once memory runs out.
  // Primal/relay: the server can't be trusted to sort/page, so sort locally
  // (5-way tabs) and pin the OP's direct replies under the relevant sort.
  let stackOrder: string[];
  if (thread.tier === 'nagg') {
    stackOrder = replyEvents.map((event) => event.id);
  } else {
    const fullSorted = sortedReplyIds(
      replyEvents,
      thread.stats as Record<string, ReplyStat>,
      request.sort
    );
    stackOrder =
      (request.sort ?? 'relevant') === 'relevant' && root
        ? facade.partitionOpFirst(fullSorted, root.pubkey, (id) => {
            const event = allEvents.get(id);
            return event && facade.isDirectReplyTo(event, request.eventId)
              ? event.pubkey
              : undefined;
          })
        : fullSorted;
  }

  const windowEnd = Math.min(stackOrder.length, pageSize);
  const serverHasMoreReplies = thread.tier === 'nagg' && thread.hasMore;

  return {
    allEvents,
    profiles,
    metrics,
    quotedEvents,
    thread: buildThreadStructure(request.eventId, allEvents),
    replyPageEventIds: stackOrder.slice(0, windowEnd),
    replyPageSize: pageSize,
    loadedReplyCount: windowEnd,
    hasMoreReplies: windowEnd < stackOrder.length || serverHasMoreReplies,
    serverHasMoreReplies,
    tier: thread.tier,
    knownReplyIds: thread.knownReplyIds,
    allSortedReplyIds: stackOrder,
  };
}

/** Empty result when every enabled tier is exhausted — keeps the thread screen
 *  honest (shows "no replies") rather than silently using nagg behind a toggle. */
export function emptyThreadResult(request: ThreadRequest): ThreadResult {
  return {
    allEvents: request.seed ? new Map(request.seed.allEvents) : new Map(),
    profiles: request.seed ? new Map(request.seed.profiles) : new Map(),
    metrics: request.seed ? new Map(request.seed.metrics) : new Map(),
    quotedEvents: request.seed ? new Map(request.seed.quotedEvents) : new Map(),
    thread: buildThreadStructure(
      request.eventId,
      request.seed ? request.seed.allEvents : new Map()
    ),
    replyPageEventIds: [],
    replyPageSize: request.limit ?? 0,
    loadedReplyCount: 0,
    hasMoreReplies: false,
    tier: null,
    knownReplyIds: [],
  };
}
