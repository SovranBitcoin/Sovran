import type {
  NoteStatsMap,
  NoteActionsMap,
  OrderingManifest,
  NostrCursor,
  NostrTier,
} from '@sovranbitcoin/schemas';
import type { NaggFeedEvent, NaggNoteMetrics, NaggProfileInfo } from '../map/feed';
import type { RequestControls } from '../timeout';
import type { TierOutcome } from '../tiers';
import { statsFromMetrics, type FeedItem } from './feed';

// ---------------------------------------------------------------------------
// Thread surface — the conversation around one note
//
// Same shape language as the feed: a tier returns the root plus its replies as
// an UNORDERED bundle + manifest; the facade applies the manifest so the reply
// order (server-ranked or chronological) renders coherently. The root is carried
// separately so the reader always has its anchor even if a reply is missing.
// ---------------------------------------------------------------------------

export type ThreadSort = 'relevant' | 'new';

export type ThreadRequest = RequestControls & {
  noteId: string;
  viewerPubkey?: string;
  sort?: ThreadSort;
  limit?: number;
  refresh?: boolean;
};

/** The structural thread response a tier maps from (matches nagg's ThreadResponse). */
export type ThreadSource = {
  root: NaggFeedEvent;
  events: NaggFeedEvent[];
  /** Server-authoritative reply order; present on the REST app-view. */
  ordering?: OrderingManifest;
  metrics: Record<string, NaggNoteMetrics>;
  profiles: Record<string, NaggProfileInfo>;
  quoted: Record<string, NaggFeedEvent>;
};

/**
 * Separate a thread batch's ANCESTORS (notes reachable upward from the root via
 * NIP-10 `e` tags) from its replies. Shared by the relay and primal demuxers so a
 * tier without a server-side parent view still surfaces — and caches — the parent
 * chain, and never lists an ancestor among the replies.
 */
export function ancestorParents(
  notesById: Map<string, NaggFeedEvent>,
  rootId: string,
): { parents: FeedItem[]; ancestorIds: Set<string> } {
  const ancestorIds = new Set<string>();
  const queue: string[] = [rootId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined || visited.has(id)) continue;
    visited.add(id);
    const note = notesById.get(id);
    if (!note) continue;
    for (const tag of note.tags) {
      if (tag[0] === 'e' && tag[1] && tag[1] !== id && tag[1] !== rootId && notesById.has(tag[1])) {
        ancestorIds.add(tag[1]);
        queue.push(tag[1]);
      }
    }
  }
  const parents: FeedItem[] = [];
  for (const id of ancestorIds) {
    const event = notesById.get(id);
    if (event) parents.push({ type: 'note', event });
  }
  return { parents, ancestorIds };
}

export type ThreadBundle = {
  root: FeedItem;
  /** Replies, unordered, keyed by id. */
  itemsById: Map<string, FeedItem>;
  manifest: OrderingManifest;
  /**
   * The root's ANCESTOR chain (its parent, grandparent, …) when the root is
   * itself a reply — so a tier without a server-side thread view (the relay
   * floor) can still show, and CACHE, the parent context. Root-ward order;
   * empty when the root starts a thread. Not part of the reply manifest.
   */
  parents: FeedItem[];
  stats: NoteStatsMap;
  actions?: NoteActionsMap;
  profiles: Record<string, NaggProfileInfo>;
  quoted: Record<string, NaggFeedEvent>;
  cursor: NostrCursor;
};

export type ResolvedThread = {
  tier: NostrTier;
  root: FeedItem;
  /** The root's ancestor chain (see ThreadBundle.parents). */
  parents: FeedItem[];
  replies: FeedItem[];
  stats: NoteStatsMap;
  actions?: NoteActionsMap;
  profiles: Record<string, NaggProfileInfo>;
  quoted: Record<string, NaggFeedEvent>;
  cursor: NostrCursor;
  missingIds: string[];
};

export interface ThreadTier {
  readonly tier: NostrTier;
  thread(request: ThreadRequest): Promise<TierOutcome<ThreadBundle>>;
}

/** Bridge nagg's already-ordered thread response into a contract `ThreadBundle`. */
export function bundleFromThread(source: ThreadSource): ThreadBundle {
  const itemsById = new Map<string, FeedItem>();
  const elements: string[] = [];
  for (const event of source.events) {
    if (itemsById.has(event.id)) continue;
    itemsById.set(event.id, { type: 'note', event });
    elements.push(event.id);
  }

  const lastId = elements[elements.length - 1];
  const lastEvent = lastId ? itemsById.get(lastId) : undefined;
  const cursor: NostrCursor =
    lastEvent && lastEvent.type === 'note'
      ? { createdAt: lastEvent.event.created_at, id: lastEvent.event.id }
      : null;

  return {
    root: { type: 'note', event: source.root },
    parents: [],
    itemsById,
    // Prefer nagg's server manifest; derive from reply order when absent.
    manifest: source.ordering ?? { orderBy: 'rank', elements },
    stats: statsFromMetrics(source.metrics),
    profiles: source.profiles,
    quoted: source.quoted,
    cursor,
  };
}
