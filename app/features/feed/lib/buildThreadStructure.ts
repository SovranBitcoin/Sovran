import { facade } from 'nostr';

import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';

export function buildThreadStructure(
  eventId: string,
  allEvents: ReadonlyMap<string, FeedEvent>
): ThreadStructure {
  const target = allEvents.get(eventId) || null;
  if (!target) return { parents: [], target: null, replies: [] };

  const parents: FeedEvent[] = [];
  const visited = new Set<string>([eventId]);
  let current: FeedEvent = target;

  // Walk up the NIP-10 parent chain (reply marker > LAST unmarked e-tag >
  // root marker — the shared helper owns the precedence rationale).
  while (true) {
    const parentId = facade.nip10ParentId(current);
    if (!parentId || visited.has(parentId)) break;
    visited.add(parentId);

    const parentEvent = allEvents.get(parentId);
    if (!parentEvent) break;

    parents.unshift(parentEvent);
    current = parentEvent;
  }

  const parentIds = new Set(parents.map((p) => p.id));
  const replies: FeedEvent[] = [];
  for (const ev of allEvents.values()) {
    if (ev.id === eventId) continue;
    if (parentIds.has(ev.id)) continue;
    if (facade.isDirectReplyTo(ev, eventId)) replies.push(ev);
  }

  replies.sort((a, b) => a.created_at - b.created_at);

  // Product invariant (relevant/default view): the target author's own direct
  // replies lead the list. Network results carry a server/page order that
  // overrides this; the partition makes cache/seed-built trees agree with it.
  const opFirst = facade.partitionOpFirst(replies, target.pubkey, (e) => e.pubkey);

  return { parents, target, replies: opFirst };
}

export type ThreadStructure = {
  parents: FeedEvent[];
  target: FeedEvent | null;
  replies: FeedEvent[];
};
