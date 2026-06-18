import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';
import type { ThreadResult, ThreadSeedBuckets } from '@/features/feed/data/feedClient';
import {
  buildThreadStructure,
  type ThreadStructure,
} from '@/features/feed/lib/buildThreadStructure';
export type ThreadItem =
  | { type: 'parent'; event: FeedEvent }
  | { type: 'target'; event: FeedEvent }
  | { type: 'reply'; event: FeedEvent };

export type BuiltThreadItems = {
  items: ThreadItem[];
  hiddenReplyCount: number;
  expectedReplies: number;
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
  const targetMetrics = result.metrics.get(eventId);
  const expectedReplies = targetMetrics?.replyCount ?? 0;
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
    hiddenReplyCount: Math.max(0, expectedReplies - replies.length),
    expectedReplies,
    receivedReplies: thread.replies.length,
  };
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

  return pageReplyIds.length > 0 ? pageReplyIds : fallbackReplyIds;
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
      thread,
      replyPageEventIds,
      replyPageSize: replyPageEventIds.length,
      loadedReplyCount: 0,
      hasMoreReplies: false,
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
