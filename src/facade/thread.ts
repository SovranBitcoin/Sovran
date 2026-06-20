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
  metrics: Record<string, NaggNoteMetrics>;
  profiles: Record<string, NaggProfileInfo>;
  quoted: Record<string, NaggFeedEvent>;
};

export type ThreadBundle = {
  root: FeedItem;
  /** Replies, unordered, keyed by id. */
  itemsById: Map<string, FeedItem>;
  manifest: OrderingManifest;
  stats: NoteStatsMap;
  actions?: NoteActionsMap;
  profiles: Record<string, NaggProfileInfo>;
  quoted: Record<string, NaggFeedEvent>;
  cursor: NostrCursor;
};

export type ResolvedThread = {
  tier: NostrTier;
  root: FeedItem;
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
    itemsById,
    manifest: { orderBy: 'rank', elements },
    stats: statsFromMetrics(source.metrics),
    profiles: source.profiles,
    quoted: source.quoted,
    cursor,
  };
}
