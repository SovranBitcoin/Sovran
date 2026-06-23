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
// one hop or cold-start from curated accounts when likes are thin, then fetch
// and rank the candidate authors' last-24h notes. That ranked block is the head
// of a per-viewer CORPUS that is cached and extended lazily: scrolling past it
// backfills OLDER notes from the same authors (recency-ranked, still per-author
// capped per block), so the feed paginates indefinitely instead of dead-ending.
//
// Pagination channel: the app's facade only round-trips `cursor.createdAt` (it
// hardcodes the cursor id to '' — facadeFeedClient), so we carry the next OFFSET
// into the corpus through `createdAt`. The app treats it opaquely: a `> 0`
// "has-more" gate it echoes straight back, the same way nagg's own For-You uses
// a sentinel. Page 0 (no/zero cursor) serves the head; a positive cursor is the
// offset to resume from.
//
// Returns null only when there's no viewer or no usable signal on page 0; the
// caller (the relay tier) then falls through to its honest recency degrade. A
// deep page past the corpus returns an empty answered bundle (cursor null) so we
// stop cleanly instead of degrading to recent-global at the bottom. Nothing here
// throws on a relay error — a failed round-trip settles as "no events".
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
  /** Upper bound on the materialized corpus — the feed ends honestly here. */
  maxCorpus: 600,
  /** Backfill rounds a single page request may trigger (bounds the latency). */
  backfillRoundsPerPage: 2,
  viewerLikesTimeoutMs: 1200,
  discoveryTimeoutMs: 1000,
  notesTimeoutMs: 1500,
  cacheTtlMs: 10 * 60 * 1000,
  defaultPageLimit: 30,
} as const;

type ForYouCorpus = {
  /** The ranked id list, head first; grows as backfill appends older blocks. */
  orderedIds: string[];
  eventsById: Map<string, NaggFeedEvent>;
  profiles: Record<string, NaggProfileInfo>;
  /** Candidate authors (for affinity scoring) and the flat author list to query. */
  candidates: CandidateAuthor[];
  authors: string[];
  /** Exclusive upper bound (unix sec) for the next older backfill query. */
  oldestFetchedAt: number;
  /** No more older notes to fetch (or corpus cap hit). */
  exhausted: boolean;
  generatedAt: number;
};

/** Per-viewer corpus cache. For-You is the only ranked relay spec. */
const cacheByViewer = new Map<string, ForYouCorpus>();

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
  const offset = cursorOffset(request.cursor);

  // (Re)build the corpus head on a fresh page-0 / refresh / expired cache.
  let corpus = freshCache(viewerPubkey, now);
  if (!corpus || (offset === 0 && request.refresh)) {
    const head = await computeHead(viewerPubkey, connection, request, now);
    if (!head) return offset > 0 ? emptyPage() : null;
    corpus = head;
    cacheByViewer.set(viewerPubkey, corpus);
  }

  // Extend the corpus with older notes until it can serve this page (or runs dry).
  let rounds = 0;
  while (
    corpus.orderedIds.length < offset + limit &&
    !corpus.exhausted &&
    rounds < DEFAULTS.backfillRoundsPerPage
  ) {
    await backfillOlder(corpus, connection, request);
    rounds += 1;
  }

  return pageFrom(corpus, offset, limit);
}

/** Test seam — drop cached state between cases. */
export function __clearRelayForYouCache(): void {
  cacheByViewer.clear();
}

/** Decode the next-offset we encoded into `cursor.createdAt` (id is always ''). */
function cursorOffset(cursor: NostrCursor | undefined): number {
  if (cursor && typeof cursor.createdAt === 'number' && cursor.createdAt > 0) {
    return Math.floor(cursor.createdAt);
  }
  return 0;
}

function freshCache(viewerPubkey: string, now: number): ForYouCorpus | null {
  const corpus = cacheByViewer.get(viewerPubkey);
  if (!corpus) return null;
  return now - corpus.generatedAt < DEFAULTS.cacheTtlMs ? corpus : null;
}

/** Slice the corpus at `offset` into a rank-manifest bundle, encoding the next offset. */
function pageFrom(corpus: ForYouCorpus, offset: number, limit: number): FeedBundle {
  const slice = corpus.orderedIds.slice(offset, offset + limit);

  const itemsById = new Map<string, FeedItem>();
  for (const id of slice) {
    const event = corpus.eventsById.get(id);
    if (event) itemsById.set(id, { type: 'note', event });
  }

  const manifest: OrderingManifest = { orderBy: 'rank', elements: slice };
  const nextOffset = offset + slice.length;
  const hasMore = nextOffset < corpus.orderedIds.length || !corpus.exhausted;
  const cursor: NostrCursor = slice.length > 0 && hasMore ? { createdAt: nextOffset, id: '' } : null;

  return { itemsById, manifest, stats: {}, profiles: corpus.profiles, quoted: {}, cursor };
}

/** An answered-but-empty page: stop cleanly past the corpus without degrading. */
function emptyPage(): FeedBundle {
  return {
    itemsById: new Map(),
    manifest: { orderBy: 'rank', elements: [] },
    stats: {},
    profiles: {},
    quoted: {},
    cursor: null,
  };
}

/** Build the corpus head: discover candidates, fetch + rank their last-24h notes. */
async function computeHead(
  viewerPubkey: string,
  connection: RelayConnection,
  request: FeedPageRequest,
  now: number,
): Promise<ForYouCorpus | null> {
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

  const notes = [...notesById.values()];
  const { rankedIds, eventsById } = rankNotes({ notes, candidates, perAuthorCap: DEFAULTS.perAuthorCap });
  return {
    orderedIds: rankedIds,
    eventsById,
    profiles,
    candidates,
    authors,
    oldestFetchedAt: oldestCreatedAt(notes, nowSec - DEFAULTS.notesWindowSec),
    exhausted: false,
    generatedAt: now,
  };
}

/** Fetch the next-older block of candidate-author notes and append it to the corpus. */
async function backfillOlder(
  corpus: ForYouCorpus,
  connection: RelayConnection,
  request: FeedPageRequest,
): Promise<void> {
  const raw = await requestEvents(
    connection,
    [{ kinds: [1], authors: corpus.authors, until: corpus.oldestFetchedAt, limit: DEFAULTS.notesLimit }],
    { signal: request.signal, timeoutMs: DEFAULTS.notesTimeoutMs },
  );
  const { notesById, profiles } = parseRelayBatch(raw);

  const fresh: NaggFeedEvent[] = [];
  for (const note of notesById.values()) {
    if (note.id && !corpus.eventsById.has(note.id)) fresh.push(note);
  }
  if (fresh.length === 0) {
    corpus.exhausted = true;
    return;
  }

  // Rank this block (recency-leaning, still per-author capped so no author floods
  // a stretch of feed) and append. Authors may recur across blocks — the cap is
  // per block, which is what keeps the feed both diverse AND effectively endless.
  const { rankedIds, eventsById } = rankNotes({
    notes: fresh,
    candidates: corpus.candidates,
    perAuthorCap: DEFAULTS.perAuthorCap,
  });
  for (const id of rankedIds) {
    const event = eventsById.get(id);
    if (event) {
      corpus.orderedIds.push(id);
      corpus.eventsById.set(id, event);
    }
  }
  mergeProfiles(corpus.profiles, profiles);

  // Step strictly older next time (relay `until` is inclusive) and honor the cap.
  corpus.oldestFetchedAt = oldestCreatedAt(fresh, corpus.oldestFetchedAt) - 1;
  if (corpus.orderedIds.length >= DEFAULTS.maxCorpus) corpus.exhausted = true;
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

/** Smallest `created_at` across notes, or the fallback when there are none. */
function oldestCreatedAt(notes: ReadonlyArray<NaggFeedEvent>, fallback: number): number {
  let oldest = Infinity;
  for (const note of notes) if (note.created_at < oldest) oldest = note.created_at;
  return Number.isFinite(oldest) ? oldest : fallback;
}

function mergeProfiles(
  into: Record<string, NaggProfileInfo>,
  from: Record<string, NaggProfileInfo>,
): void {
  for (const [pubkey, profile] of Object.entries(from)) {
    if (!into[pubkey]) into[pubkey] = profile;
  }
}
