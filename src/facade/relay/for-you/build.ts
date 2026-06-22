import type { NostrCursor, OrderingManifest } from '@sovranbitcoin/schemas';
import type { NaggFeedEvent, NaggProfileInfo } from '../../../map/feed';
import type { FeedBundle, FeedItem, FeedPageRequest } from '../../feed';
import { toFeedEvent } from '../../event';
import { parseRelayBatch } from '../demux';
import type { NostrFilter, RawRelayEvent, RelayConnection } from '../protocol';
import { CURATED_FOR_YOU_PUBKEYS } from './curated';
import {
  distinctTargetAuthors,
  mergeCandidates,
  rankNotes,
  tallyLikedAuthors,
  type CandidateAuthor,
} from './discovery';

// ---------------------------------------------------------------------------
// Relay For-You orchestrator
//
// Drives the relay round-trips the pure `discovery` primitives can't: harvest
// the viewer's likes (widening the window until there's enough signal), expand
// one hop or cold-start from curated accounts when the viewer's likes are thin,
// then fetch and rank the candidate authors' last-24h notes. The ranked set is
// materialized ONCE per viewer and cached, so pagination is a pure slice (no
// reshuffle) and a warm re-entry costs zero relay round-trips — the lever that
// keeps the cold path inside the ~3s budget on the second look.
//
// Returns null when there's no viewer or no usable signal; the caller (the relay
// tier) then falls through to its honest recency degrade. Nothing here throws on
// a relay error — a failed round-trip settles as "no events" so a partial answer
// still renders within budget.
// ---------------------------------------------------------------------------

const SEC = 1;
const DAY_SEC = 86_400 * SEC;

const DEFAULTS = {
  likeWindowStepsSec: [7 * DAY_SEC, 30 * DAY_SEC, 90 * DAY_SEC, 365 * DAY_SEC],
  /** Stop widening once this many usable viewer likes are collected. */
  targetViewerLikes: 40,
  /** Below this many distinct liked authors, expand one hop out. */
  minAuthors: 8,
  viewerLikesLimit: 160,
  oneHopSeedCap: 20,
  discoverySinceSec: 14 * DAY_SEC,
  reactionsLimit: 500,
  candidateCap: 60,
  perAuthorCap: 2,
  notesLimit: 240,
  notesWindowSec: DAY_SEC,
  viewerLikesTimeoutMs: 1200,
  discoveryTimeoutMs: 1000,
  notesTimeoutMs: 1500,
  cacheTtlMs: 10 * 60 * 1000,
  defaultPageLimit: 30,
} as const;

type RankedSet = {
  rankedIds: string[];
  eventsById: Map<string, NaggFeedEvent>;
  profiles: Record<string, NaggProfileInfo>;
  generatedAt: number;
};

/** Per-viewer cache of the materialized ranked set. For-You is the only ranked relay spec. */
const cacheByViewer = new Map<string, RankedSet>();

export type BuildRelayForYouArgs = {
  viewerPubkey?: string;
  connection: RelayConnection;
  request: FeedPageRequest;
  now?: number;
};

export async function buildRelayForYouFeed(args: BuildRelayForYouArgs): Promise<FeedBundle | null> {
  const { viewerPubkey, connection, request } = args;
  if (!viewerPubkey) return null;
  const now = args.now ?? Date.now();
  const limit = request.limit ?? DEFAULTS.defaultPageLimit;

  const cached = freshCache(viewerPubkey, now);

  // Warm page-0: serve the cached ranked set instantly (no relay round-trip).
  if (!request.cursor && cached && !request.refresh) {
    return pageFrom(cached, null, limit);
  }

  // Continuation against a warm cache: pure slice after the cursor id.
  if (request.cursor && cached) {
    return pageFrom(cached, request.cursor, limit);
  }

  // Cold (or refresh, or stale continuation): rebuild the ranked set, then page.
  const set = await computeRankedSet(viewerPubkey, connection, request, now);
  if (!set || set.rankedIds.length === 0) return null;
  cacheByViewer.set(viewerPubkey, set);
  return pageFrom(set, request.cursor ?? null, limit);
}

/** Test seam — drop cached state between cases. */
export function __clearRelayForYouCache(): void {
  cacheByViewer.clear();
}

function freshCache(viewerPubkey: string, now: number): RankedSet | null {
  const set = cacheByViewer.get(viewerPubkey);
  if (!set) return null;
  return now - set.generatedAt < DEFAULTS.cacheTtlMs ? set : null;
}

/** Slice the materialized ranked list into a rank-manifest bundle. */
function pageFrom(set: RankedSet, cursor: NostrCursor, limit: number): FeedBundle {
  const startIndex = cursor ? set.rankedIds.indexOf(cursor.id) + 1 : 0;
  const slice = set.rankedIds.slice(startIndex, startIndex + limit);

  const itemsById = new Map<string, FeedItem>();
  for (const id of slice) {
    const event = set.eventsById.get(id);
    if (event) itemsById.set(id, { type: 'note', event });
  }

  const manifest: OrderingManifest = { orderBy: 'rank', elements: slice };
  const hasMore = startIndex + limit < set.rankedIds.length;
  const lastEvent = slice.length > 0 ? set.eventsById.get(slice[slice.length - 1]) : undefined;
  const nextCursor: NostrCursor =
    hasMore && lastEvent ? { createdAt: lastEvent.created_at, id: lastEvent.id } : null;

  return { itemsById, manifest, stats: {}, profiles: set.profiles, quoted: {}, cursor: nextCursor };
}

async function computeRankedSet(
  viewerPubkey: string,
  connection: RelayConnection,
  request: FeedPageRequest,
  now: number,
): Promise<RankedSet | null> {
  const nowSec = Math.floor(now / 1000);

  // Stage 1 — the viewer's own likes, widening until there's enough signal.
  const viewerLikes = await fetchViewerLikes(viewerPubkey, connection, request, nowSec);
  const viewerCandidates = tallyLikedAuthors(viewerLikes, {
    source: 'viewer',
    excludePubkey: viewerPubkey,
  });

  // Stage 2 — pick the candidate set: own likes, one-hop expansion, or cold start.
  let candidates: CandidateAuthor[];
  if (viewerCandidates.length === 0) {
    const reactions = await fetchReactionsByAuthors(CURATED_FOR_YOU_PUBKEYS, connection, request, nowSec);
    candidates = mergeCandidates(
      [tallyLikedAuthors(reactions, { source: 'curated', excludePubkey: viewerPubkey })],
      { maxAuthors: DEFAULTS.candidateCap, exclude: [viewerPubkey] },
    );
  } else if (viewerCandidates.length < DEFAULTS.minAuthors) {
    const seeds = viewerCandidates.slice(0, DEFAULTS.oneHopSeedCap).map((c) => c.pubkey);
    const reactions = await fetchReactionsByAuthors(seeds, connection, request, nowSec);
    const oneHop = tallyLikedAuthors(reactions, { source: 'one-hop', excludePubkey: viewerPubkey });
    candidates = mergeCandidates([viewerCandidates, oneHop], {
      maxAuthors: DEFAULTS.candidateCap,
      exclude: [viewerPubkey],
    });
  } else {
    candidates = mergeCandidates([viewerCandidates], {
      maxAuthors: DEFAULTS.candidateCap,
      exclude: [viewerPubkey],
    });
  }
  if (candidates.length === 0) return null;

  // Stage 3 — the candidate authors' last-24h notes, with their kind-0 in the
  // same batch so profiles render without a second round (demux extracts both).
  const authors = candidates.map((c) => c.pubkey);
  const raw = await requestEvents(
    connection,
    [
      { kinds: [1], authors, since: nowSec - DEFAULTS.notesWindowSec, limit: DEFAULTS.notesLimit },
      { kinds: [0], authors },
    ],
    { signal: request.signal, timeoutMs: DEFAULTS.notesTimeoutMs },
  );
  const { notesById, profiles } = parseRelayBatch(raw);
  if (notesById.size === 0) return null;

  const { rankedIds, eventsById } = rankNotes({
    notes: [...notesById.values()],
    candidates,
    perAuthorCap: DEFAULTS.perAuthorCap,
  });
  return { rankedIds, eventsById, profiles, generatedAt: now };
}

/** Harvest the viewer's kind-7 likes, widening the window until target or budget. */
async function fetchViewerLikes(
  viewerPubkey: string,
  connection: RelayConnection,
  request: FeedPageRequest,
  nowSec: number,
): Promise<NaggFeedEvent[]> {
  const byId = new Map<string, NaggFeedEvent>();
  for (const windowSec of DEFAULTS.likeWindowStepsSec) {
    const raw = await requestEvents(
      connection,
      [{ kinds: [7], authors: [viewerPubkey], since: nowSec - windowSec, limit: DEFAULTS.viewerLikesLimit }],
      { signal: request.signal, timeoutMs: DEFAULTS.viewerLikesTimeoutMs },
    );
    for (const event of toReactions(raw)) byId.set(event.id, event);
    const likes = [...byId.values()];
    if (distinctTargetAuthors(likes) >= DEFAULTS.targetViewerLikes) break;
  }
  return [...byId.values()];
}

async function fetchReactionsByAuthors(
  authors: ReadonlyArray<string>,
  connection: RelayConnection,
  request: FeedPageRequest,
  nowSec: number,
): Promise<NaggFeedEvent[]> {
  if (authors.length === 0) return [];
  const raw = await requestEvents(
    connection,
    [
      {
        kinds: [7],
        authors: [...authors],
        since: nowSec - DEFAULTS.discoverySinceSec,
        limit: DEFAULTS.reactionsLimit,
      },
    ],
    { signal: request.signal, timeoutMs: DEFAULTS.discoveryTimeoutMs },
  );
  return toReactions(raw);
}

/** A relay round-trip that settles to `[]` on error — partial answers still render. */
async function requestEvents(
  connection: RelayConnection,
  filters: NostrFilter[],
  controls: { signal?: AbortSignal; timeoutMs?: number },
): Promise<RawRelayEvent[]> {
  const result = await connection.request(filters, controls);
  return result.match(
    (events) => events,
    () => [],
  );
}

function toReactions(raw: ReadonlyArray<RawRelayEvent>): NaggFeedEvent[] {
  const out: NaggFeedEvent[] = [];
  for (const event of raw) {
    const coerced = toFeedEvent(event);
    if (coerced && coerced.kind === 7) out.push(coerced);
  }
  return out;
}
