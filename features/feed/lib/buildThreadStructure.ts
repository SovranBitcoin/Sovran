import { ShortTextNote } from 'nostr-tools/kinds';

import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';

const NIP22_COMMENT_KIND = 1111;
const THREAD_REPLY_KINDS: ReadonlySet<number> = new Set([ShortTextNote, NIP22_COMMENT_KIND]);

type ReplyMarker = 'reply' | 'root' | 'mention';

const REPLY_MARKERS: ReadonlySet<ReplyMarker> = new Set(['reply', 'root', 'mention']);

function eTagsOf(event: FeedEvent): string[][] {
  return (event.tags || []).filter((t) => t[0] === 'e');
}

export function buildThreadStructure(
  eventId: string,
  allEvents: ReadonlyMap<string, FeedEvent>
): ThreadStructure {
  const target = allEvents.get(eventId) || null;
  if (!target) return { parents: [], target: null, replies: [] };

  const parents: FeedEvent[] = [];
  const visited = new Set<string>([eventId]);
  let current: FeedEvent = target;

  while (true) {
    const eTags = eTagsOf(current);
    const replyTag = eTags.find((t) => t[3] === 'reply');
    const rootTag = eTags.find((t) => t[3] === 'root');
    // NIP-10 deprecated positional convention: with unmarked e-tags the FIRST
    // is the thread root and the LAST is the immediate parent (middle ones are
    // mentions). Picking the first unmarked tag here would skip the real parent
    // — e.g. an A→B→A chain would render A→A instead of A→B→A. So the immediate
    // parent is: an explicit `reply` marker, else the LAST unmarked e-tag, and
    // only the `root` marker as a last resort (a direct reply to the root).
    const unmarked = eTags.filter((t) => !t[3]);
    const positionalParent = unmarked.length > 0 ? unmarked[unmarked.length - 1] : null;
    const parentTag = replyTag ?? positionalParent ?? rootTag ?? null;

    if (!parentTag) break;
    const parentId = parentTag[1];
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
    if (!THREAD_REPLY_KINDS.has(ev.kind)) continue;
    if (parentIds.has(ev.id)) continue;

    const eTags = eTagsOf(ev);
    const replyTag = eTags.find((t) => t[3] === 'reply');
    if (replyTag && replyTag[1] === eventId) {
      replies.push(ev);
      continue;
    }
    if (!replyTag) {
      const rootTag = eTags.find((t) => t[3] === 'root');
      if (rootTag && rootTag[1] === eventId) {
        replies.push(ev);
        continue;
      }
    }
    if (!replyTag && eTags.length > 0) {
      const lastETag = eTags[eTags.length - 1];
      const marker = lastETag[3] as ReplyMarker | undefined;
      if (lastETag[1] === eventId && (!marker || !REPLY_MARKERS.has(marker))) {
        replies.push(ev);
      }
    }
  }

  replies.sort((a, b) => a.created_at - b.created_at);

  return { parents, target, replies };
}

export type ThreadStructure = {
  parents: FeedEvent[];
  target: FeedEvent | null;
  replies: FeedEvent[];
};
