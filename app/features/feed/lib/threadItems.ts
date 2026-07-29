import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';
import type { ThreadResult, ThreadSeedBuckets } from '@/features/feed/data/feedClient';
import {
  buildThreadStructure,
  type ThreadStructure,
} from '@/features/feed/lib/buildThreadStructure';
export type ThreadItem =
  | { type: 'parent'; event: FeedEvent }
  | { type: 'target'; event: FeedEvent }
  | { type: 'reply'; event: FeedEvent }
  | { type: 'spam-separator'; count: number }
  | { type: 'spam-reply'; event: FeedEvent };

export type BuiltThreadItems = {
  items: ThreadItem[];
  receivedReplies: number;
};

export function bucketsFromThreadResult(result: ThreadResult): ThreadSeedBuckets {
  return {
    allEvents: result.allEvents,
    profiles: result.profiles,
    metrics: result.metrics,
    quotedEvents: result.quotedEvents,
    replyPreviewEventIds: result.replyPreviewEventIds,
  };
}

export function buildThreadItemsFromResult(
  eventId: string,
  result: ThreadResult,
  orderedReplyIds?: readonly string[]
): BuiltThreadItems | null {
  const { thread } = result;
  if (!thread.target) return null;

  const target = thread.target;
  const replyById = new Map(thread.replies.map((event) => [event.id, event]));
  // Replies render in the order the server returned them (the chosen sort). The
  // page-id ordering, when present, preserves pagination order across fetches.
  const replies = orderedReplyIds
    ? orderedReplyIds.map((id) => replyById.get(id)).filter((event): event is FeedEvent => !!event)
    : thread.replies;
  const items: ThreadItem[] = [
    ...thread.parents.map<ThreadItem>((event) => ({ type: 'parent', event })),
    { type: 'target', event: target },
    ...replies.map<ThreadItem>((event) => ({ type: 'reply', event })),
  ];

  return {
    items,
    receivedReplies: thread.replies.length,
  };
}

export type ThreadIgnoreFilters = {
  pubkeys: ReadonlySet<string>;
  eventIds: ReadonlySet<string>;
};

/**
 * Pure final composition of the thread list: apply the viewer's ignore filters
 * to replies (NEVER the target; parents stay for context), then — only once the
 * primary list is fully loaded — append the "Might be spam" section: a
 * separator carrying the surviving count, followed by the audit-found replies.
 */
export function composeThreadItems(
  built: readonly ThreadItem[],
  spamReplies: readonly FeedEvent[],
  ignore: ThreadIgnoreFilters,
  options: { includeSpam: boolean }
): ThreadItem[] {
  const isIgnored = (event: FeedEvent): boolean =>
    ignore.pubkeys.has(event.pubkey) || ignore.eventIds.has(event.id);

  const primaryIds = new Set<string>();
  const items: ThreadItem[] = [];
  for (const item of built) {
    if ((item.type === 'reply' || item.type === 'spam-reply') && isIgnored(item.event)) continue;
    if (item.type === 'reply' || item.type === 'target' || item.type === 'parent') {
      primaryIds.add(item.event.id);
    }
    items.push(item);
  }

  if (!options.includeSpam) return items;
  const spam = spamReplies.filter((event) => !primaryIds.has(event.id) && !isIgnored(event));
  if (spam.length === 0) return items;
  return [
    ...items,
    { type: 'spam-separator', count: spam.length },
    ...spam.map<ThreadItem>((event) => ({ type: 'spam-reply', event })),
  ];
}

export function orderedReplyIdsForThreadResult(
  result: ThreadResult,
  source: 'initial' | 'more',
  existingReplyOrder: readonly string[]
): string[] {
  const replyIds = new Set(result.thread.replies.map((event) => event.id));
  const pageReplyIds = uniqueIds(result.replyPageEventIds.filter((id) => replyIds.has(id)));
  const pageReplyIdSet = new Set(pageReplyIds);
  const fallbackReplyIds = uniqueIds(
    result.thread.replies.map((event) => event.id).filter((id) => !pageReplyIdSet.has(id))
  );
  const existingOrder = uniqueIds(existingReplyOrder.filter((id) => replyIds.has(id)));
  const existingOrderSet = new Set(existingOrder);
  const nextPageReplyIds =
    pageReplyIds.length > 0
      ? pageReplyIds
      : fallbackReplyIds.filter((id) => !existingOrderSet.has(id));

  if (source === 'more') {
    return [...existingOrder, ...nextPageReplyIds.filter((id) => !existingOrderSet.has(id))];
  }

  // Initial fetch: keep whatever was already on screen (the cache-seeded previews)
  // as a stable prefix and APPEND the ranked delta, instead of replacing the order
  // outright — so the replies don't visibly reshuffle when the network result lands.
  // With no seed, existingOrder is empty and this is just the server's order.
  const initialReplyIds = pageReplyIds.length > 0 ? pageReplyIds : fallbackReplyIds;
  return [...existingOrder, ...initialReplyIds.filter((id) => !existingOrderSet.has(id))];
}

export function buildThreadItemsFromSeed(
  eventId: string,
  seed: ThreadSeedBuckets
): BuiltThreadItems | null {
  const thread = includeSelectedReplyIdsInThread(
    buildThreadStructure(eventId, seed.allEvents),
    seed.allEvents,
    seed.replyPreviewEventIds ?? []
  );
  if (!thread.target) return null;

  const replyIds = new Set(thread.replies.map((event) => event.id));
  const previewReplyIds = seed.replyPreviewEventIds?.filter((id) => replyIds.has(id)) ?? [];
  const replyPageEventIds =
    previewReplyIds.length > 0
      ? uniqueIds(previewReplyIds)
      : thread.replies.map((event) => event.id);
  return buildThreadItemsFromResult(
    eventId,
    {
      allEvents: seed.allEvents,
      profiles: seed.profiles,
      metrics: seed.metrics,
      quotedEvents: seed.quotedEvents,
      // Seed the focused note at index 0 — drop any ancestors the originating
      // context happened to include. The note then mounts at the TOP and stays
      // focused as the real parent chain loads in above it (held by
      // maintainVisibleContentPosition), instead of landing mid-list via a fragile
      // estimated `initialScrollIndex`. This matches the notifications entry (which
      // seeds no ancestors) so every entry point focuses the note the same way.
      thread: { ...thread, parents: [] },
      replyPageEventIds,
      replyPageSize: replyPageEventIds.length,
      loadedReplyCount: 0,
      hasMoreReplies: false,
      tier: null,
      knownReplyIds: [],
    },
    replyPageEventIds
  );
}

function includeSelectedReplyIdsInThread(
  thread: ThreadStructure,
  allEvents: ReadonlyMap<string, FeedEvent>,
  replyIds: readonly string[]
): ThreadStructure {
  if (!thread.target || replyIds.length === 0) return thread;
  const existingIds = new Set([
    thread.target.id,
    ...thread.parents.map((event) => event.id),
    ...thread.replies.map((event) => event.id),
  ]);
  const selectedReplies: FeedEvent[] = [];
  for (const id of replyIds) {
    const event = allEvents.get(id);
    if (!event || existingIds.has(event.id)) continue;
    existingIds.add(event.id);
    selectedReplies.push(event);
  }
  if (selectedReplies.length === 0) return thread;
  return {
    ...thread,
    replies: [...thread.replies, ...selectedReplies],
  };
}

function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
