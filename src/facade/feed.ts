import type {
  NoteStats,
  NoteStatsMap,
  NoteActionsMap,
  OrderingManifest,
  NostrCursor,
  NostrTier,
} from '@sovranbitcoin/schemas';
import type { NaggFeedItem, NaggFeedEvent, NaggNoteMetrics, NaggProfileInfo, NaggFeedPage } from '../map/feed';
import type { RequestControls } from '../timeout';
import type { TierOutcome } from '../tiers';

// ---------------------------------------------------------------------------
// Feed surface — domain request + result + the per-tier contract
//
// A caller asks the facade for a feed page in domain terms (which spec, where
// to page from, who's viewing). It never names a tier or assembles events. Each
// tier returns an UNORDERED `FeedBundle` keyed by id plus a manifest; the facade
// applies the manifest uniformly so ordering (anti-reshuffle) lives in ONE place.
// ---------------------------------------------------------------------------

/** Which algorithmic feed the caller wants. Tiers map this to their own query. */
export type FeedSpec =
  | { kind: 'for-you'; viewerPubkey?: string }
  | { kind: 'following-popular'; viewerPubkey: string };

export type FeedPageRequest = RequestControls & {
  spec: FeedSpec;
  /** Page position from a previous result's `cursor` (null/undefined = newest). */
  cursor?: NostrCursor;
  limit?: number;
  refresh?: boolean;
};

/** A feed entry: the existing nagg feed item, ready to render. */
export type FeedItem = NaggFeedItem;

/**
 * One tier's answer: the bundle UNORDERED (keyed by feed-item id) plus the
 * server-authoritative manifest. The facade applies the manifest to produce the
 * ordered page, so a tier only has to declare what its order IS.
 */
export type FeedBundle = {
  itemsById: Map<string, FeedItem>;
  manifest: OrderingManifest;
  stats: NoteStatsMap;
  /** Per-viewer overlay; absent on the relay floor and until nagg emits it. */
  actions?: NoteActionsMap;
  profiles: Record<string, NaggProfileInfo>;
  quoted: Record<string, NaggFeedEvent>;
  cursor: NostrCursor;
};

/** What the facade returns: an ordered, validated page tagged with the answering tier. */
export type ResolvedFeedPage = {
  tier: NostrTier;
  items: FeedItem[];
  stats: NoteStatsMap;
  actions?: NoteActionsMap;
  profiles: Record<string, NaggProfileInfo>;
  quoted: Record<string, NaggFeedEvent>;
  cursor: NostrCursor;
  /** Manifest ids we were told to render but didn't receive — for lazy backfill. */
  missingIds: string[];
};

/** The feed slice of a tier strategy. Composed with the other surfaces as they land. */
export interface FeedTier {
  readonly tier: NostrTier;
  feedPage(request: FeedPageRequest): Promise<TierOutcome<FeedBundle>>;
}

// ---------------------------------------------------------------------------
// Bridge helpers — turn a current `NaggFeedPage` into a contract `FeedBundle`
// ---------------------------------------------------------------------------

/** Stable id for a feed item: the note's id, or a repost's original (anchor) id. */
export function feedItemId(item: FeedItem): string {
  return item.type === 'note' ? item.event.id : item.originalEventId ?? item.repostEvent.id;
}

/**
 * Map nagg's per-note metrics onto the shared `NoteStats` contract. nagg does not
 * yet emit a discrete zap COUNT (only `satsZapped`), so `zaps` bridges to 0 until
 * the v2 response carries it; the sats total is preserved.
 */
export function statsFromMetrics(metrics: Record<string, NaggNoteMetrics>): NoteStatsMap {
  const out: Record<string, NoteStats> = {};
  for (const [id, m] of Object.entries(metrics)) {
    out[id] = {
      likes: m.likeCount,
      reposts: m.repostCount,
      replies: m.replyCount,
      zaps: 0,
      satsZapped: m.satsZapped,
    };
  }
  return out;
}

/**
 * Bridge today's already-ordered `NaggFeedPage` into a `FeedBundle`: derive the
 * manifest from the server's item order (nagg ranks server-side and returns items
 * in order), key items by id, and convert metrics to the stats contract. Once
 * nagg emits an explicit manifest (v2), the tier passes it straight through.
 */
export function bundleFromFeedPage(page: NaggFeedPage): FeedBundle {
  const itemsById = new Map<string, FeedItem>();
  const elements: string[] = [];
  for (const item of page.items) {
    const id = feedItemId(item);
    if (itemsById.has(id)) continue; // de-dupe a repeated anchor (e.g. merged reposts)
    itemsById.set(id, item);
    elements.push(id);
  }

  const lastId = elements.length > 0 ? elements[elements.length - 1] : undefined;
  const cursor: NostrCursor =
    page.paginationUntil > 0 && lastId ? { createdAt: page.paginationUntil, id: lastId } : null;

  // Prefer nagg's server-authoritative manifest (it knows the order SEMANTIC —
  // rank vs created_at); fall back to deriving from item order when absent (the
  // GraphQL path and tiers that don't emit one).
  const manifest: OrderingManifest = page.ordering ?? { orderBy: 'rank', elements };

  return {
    itemsById,
    manifest,
    stats: statsFromMetrics(page.metrics),
    profiles: page.profiles,
    quoted: page.quoted,
    cursor,
  };
}
