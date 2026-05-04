import { ShortTextNote } from 'nostr-tools/kinds';

import type { FeedEvent } from '@/features/feed/components/nostr/shared';

type ParentMarker = 'reply' | 'root';
type ReplyMarker = 'reply' | 'root' | 'mention';

const PARENT_MARKERS: ReadonlySet<ParentMarker> = new Set(['reply', 'root']);
const REPLY_MARKERS: ReadonlySet<ReplyMarker> = new Set(['reply', 'root', 'mention']);

function eTagsOf(event: FeedEvent): string[][] {
  return (event.tags || []).filter((t) => t[0] === 'e');
}

export function buildThreadStructure(
  eventId: string,
  allEvents: ReadonlyMap<string, FeedEvent>
): { parents: FeedEvent[]; target: FeedEvent | null; replies: FeedEvent[] } {
  const target = allEvents.get(eventId) || null;
  if (!target) return { parents: [], target: null, replies: [] };

  const parents: FeedEvent[] = [];
  const visited = new Set<string>([eventId]);
  let current: FeedEvent = target;

  while (true) {
    const eTags = eTagsOf(current);
    const replyTag = eTags.find((t) => t[3] === 'reply');
    const rootTag = eTags.find((t) => t[3] === 'root');
    const positional = eTags.find((t) => !t[3] || PARENT_MARKERS.has(t[3] as ParentMarker));
    const fallbackPositional =
      !replyTag && !rootTag && eTags.length > 0 ? (positional ?? null) : null;
    const parentTag = replyTag ?? rootTag ?? fallbackPositional;

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
    if (ev.kind !== ShortTextNote) continue;
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
