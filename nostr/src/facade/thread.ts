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

export type ThreadSort = 'relevant' | 'ranked' | 'new';

export type ThreadRequest = RequestControls & {
  noteId: string;
  viewerPubkey?: string;
  /** Defaults to 'relevant' — the product sort with the OP's direct replies pinned first. */
  sort?: ThreadSort;
  /** Reply-page window; server-windowed on nagg, ignored by single-shot tiers. */
  offset?: number;
  replyLimit?: number;
  /** Total fetch budget (candidate pool on nagg; batch limit on primal/relay). */
  limit?: number;
  refresh?: boolean;
};

/** The structural thread response a tier maps from (matches nagg's ThreadResponse). */
export type ThreadSource = {
  root: NaggFeedEvent;
  events: NaggFeedEvent[];
  /** Server-authoritative reply order; present on the REST app-view. */
  ordering?: OrderingManifest;
  /** Hydrated events outside the ordered page (see ThreadBundle.extras). */
  extraEvents?: Record<string, NaggFeedEvent>;
  /** Server's pre-paging ordered-reply total; undefined on single-shot tiers. */
  totalReplies?: number;
  /** Next page offset; undefined when the ordered list is exhausted. */
  nextOffset?: number;
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
  /**
   * Hydrated events the tier returned that the manifest does NOT order
   * (off-page descendants, quoted hydration). Never rendered in the reply
   * list (anti-reshuffle); ingested into the cache and counted into the
   * thread-audit baseline. Empty on primal/relay.
   */
  extras: FeedItem[];
  /**
   * Truthful "more ordered replies exist beyond this window". nagg: derived
   * from the envelope cursor. Primal/relay: always false — they return the
   * full thread in one shot; any windowing is the caller's, from memory.
   */
  hasMore: boolean;
  /** Next server page offset; undefined when exhausted or not applicable. */
  nextOffset?: number;
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
  /** Manifest-ordered reply page (OP-pinned under the relevant sort). */
  replies: FeedItem[];
  extras: FeedItem[];
  hasMore: boolean;
  nextOffset?: number;
  /**
   * Every reply id this answer acknowledges — manifest elements ∪ extras ids,
   * i.e. the UNPAGINATED known set the thread-audit diff compares against.
   */
  knownReplyIds: string[];
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

// ---------------------------------------------------------------------------
// Thread audit — the "Might be spam" second opinion
//
// After the primary source rendered the reply list, the tiers BELOW it are
// consulted in the background. Direct replies they return that the primary
// never acknowledged surface as a separate bucket — never merged into the
// primary order.
// ---------------------------------------------------------------------------

export type ThreadAuditRequest = RequestControls & {
  noteId: string;
  /** The thread author; audit-found replies by them are promoted, not spam. */
  opPubkey: string;
  /** Tier that served the primary read; only tiers strictly BELOW it are consulted. */
  primaryTier: NostrTier;
  /** The primary source's full acknowledged reply-id set (unpaginated). */
  knownReplyIds: ReadonlyArray<string>;
};

export type ResolvedThreadAudit = {
  /** Provenance of the findings; null = no lower tier answered → nothing to show. */
  tier: NostrTier | null;
  /** Direct replies the primary source did not acknowledge, recency-descending — the spam bucket. */
  extras: FeedItem[];
  /** Same diff, but authored by the OP (chronological): promoted into the main list, never spam. */
  opExtras: FeedItem[];
  stats: NoteStatsMap;
  profiles: Record<string, NaggProfileInfo>;
};

/** Bridge nagg's already-ordered thread response into a contract `ThreadBundle`. */
export function bundleFromThread(source: ThreadSource): ThreadBundle {
  const itemsById = new Map<string, FeedItem>();
  const elements: string[] = [];
  for (const event of source.events) {
    if (itemsById.has(event.id)) continue;
    itemsById.set(event.id, { type: 'note', event });
    elements.push(event.id);
  }

  // Extras join itemsById (cache/tap-through hydration) but never the
  // manifest — applyOrderingManifest refuses to render off-manifest entries,
  // so the ordered page stays exactly the server's.
  const extras: FeedItem[] = [];
  for (const event of Object.values(source.extraEvents ?? {})) {
    if (itemsById.has(event.id)) continue;
    const item: FeedItem = { type: 'note', event };
    itemsById.set(event.id, item);
    extras.push(item);
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
    extras,
    hasMore: source.nextOffset !== undefined,
    ...(source.nextOffset !== undefined ? { nextOffset: source.nextOffset } : {}),
    stats: statsFromMetrics(source.metrics),
    profiles: source.profiles,
    quoted: source.quoted,
    cursor,
  };
}

// ---------------------------------------------------------------------------
// Shared reply-order + NIP-10 helpers — one implementation for every tier and
// for the app's tree builder, so server ordering, client ordering, and the
// thread-audit diff can never drift apart.
// ---------------------------------------------------------------------------

/**
 * Stable partition: items authored by `opPubkey` first (original relative
 * order kept), then the rest (original relative order kept). Idempotent —
 * re-applying over nagg's server-pinned relevant order is a no-op, so it can
 * never reshuffle a manifest that already leads with the OP block.
 */
export function partitionOpFirst<T>(
  items: readonly T[],
  opPubkey: string,
  authorOf: (item: T) => string | undefined,
): T[] {
  const op: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    (authorOf(item) === opPubkey ? op : rest).push(item);
  }
  return op.length === 0 ? [...items] : [...op, ...rest];
}

type TaggedEvent = Pick<NaggFeedEvent, 'tags'>;

const NIP22_COMMENT_KIND = 1111;
const THREAD_REPLY_KINDS: ReadonlySet<number> = new Set([1, NIP22_COMMENT_KIND]);
const REPLY_MARKERS: ReadonlySet<string> = new Set(['reply', 'root', 'mention']);

function eTagsOf(event: TaggedEvent): string[][] {
  return (event.tags || []).filter((t) => t[0] === 'e');
}

/**
 * NIP-10 immediate-parent id: an explicit `reply` marker, else the LAST
 * unmarked e-tag (deprecated positional convention: first = root, last =
 * parent — picking the first would render an A→B→A chain as A→A), else the
 * `root` marker (a direct reply to the root). Ported verbatim from the app's
 * buildThreadStructure parent walk.
 */
export function nip10ParentId(event: TaggedEvent): string | undefined {
  const eTags = eTagsOf(event);
  const replyTag = eTags.find((t) => t[3] === 'reply');
  const rootTag = eTags.find((t) => t[3] === 'root');
  const unmarked = eTags.filter((t) => !t[3]);
  const positionalParent = unmarked.length > 0 ? unmarked[unmarked.length - 1] : null;
  const parentTag = replyTag ?? positionalParent ?? rootTag ?? null;
  return parentTag?.[1] || undefined;
}

/**
 * Direct-reply classification, ported verbatim from the app's
 * buildThreadStructure reply scan. NOTE: this deliberately mirrors that
 * scan's precedence (reply marker → root marker → unmarked positional),
 * which differs from nip10ParentId's on the malformed root-marker+unmarked
 * combination — the thread UI has always classified that as a direct reply
 * to the root, and the audit diff must agree with what the UI renders.
 */
export function isDirectReplyTo(
  event: TaggedEvent & Pick<NaggFeedEvent, 'kind'>,
  targetId: string,
): boolean {
  if (!THREAD_REPLY_KINDS.has(event.kind)) return false;
  const eTags = eTagsOf(event);
  const replyTag = eTags.find((t) => t[3] === 'reply');
  if (replyTag) return replyTag[1] === targetId;
  const rootTag = eTags.find((t) => t[3] === 'root');
  if (rootTag && rootTag[1] === targetId) return true;
  if (eTags.length > 0) {
    const lastETag = eTags[eTags.length - 1];
    const marker = lastETag[3];
    return lastETag[1] === targetId && (!marker || !REPLY_MARKERS.has(marker));
  }
  return false;
}
