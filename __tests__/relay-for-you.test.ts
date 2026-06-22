import { describe, test, expect, beforeEach } from 'vitest';
import { ok, type Result } from 'neverthrow';
import type { NaggError } from '../src/errors';
import type { RawRelayEvent, RelayConnection, NostrFilter } from '../src/facade/relay/protocol';
import type { FeedPageRequest } from '../src/facade/feed';
import {
  targetAuthorFromReaction,
  tallyLikedAuthors,
  mergeCandidates,
  distinctTargetAuthors,
  rankNotes,
  type CandidateAuthor,
} from '../src/facade/relay/for-you/discovery';
import {
  buildRelayForYouFeed,
  __clearRelayForYouCache,
} from '../src/facade/relay/for-you/build';

// --- event builders --------------------------------------------------------

const hex = (seed: string): string => (seed + '0'.repeat(64)).slice(0, 64);

// Unique, hex-valid event ids — a counter so no two fixture events collide.
let _seq = 0;
const uid = (): string => (++_seq).toString(16).padStart(64, '0');

const V = hex('viewer');
const A = hex('authorA');
const B = hex('authorB');
const E = hex('authorE'); // discovered one hop out

function reaction(reactor: string, target: string, eventId: string, createdAt = 1000): RawRelayEvent {
  return {
    id: uid(),
    pubkey: reactor,
    kind: 7,
    content: '+',
    tags: [
      ['e', eventId],
      ['p', target],
    ],
    created_at: createdAt,
  };
}

function note(author: string, n: number, createdAt = 2000): RawRelayEvent {
  return { id: uid(), pubkey: author, kind: 1, content: 'gm ' + n, tags: [], created_at: createdAt };
}

function profile(author: string, name: string): RawRelayEvent {
  return { id: uid(), pubkey: author, kind: 0, content: JSON.stringify({ name }), tags: [] };
}

function asFeedEvent(raw: RawRelayEvent) {
  return { ...raw, id: raw.id!, pubkey: raw.pubkey!, content: raw.content ?? '', tags: raw.tags as string[][], created_at: raw.created_at ?? 0 };
}

// A filter-aware fake: routes by kind, and (for kind-7) by whether the viewer is
// the reactor, so the staged pipeline can be exercised end to end.
function routedConnection(routes: {
  viewerLikes?: RawRelayEvent[];
  seedLikes?: RawRelayEvent[];
  notes?: RawRelayEvent[];
}): RelayConnection {
  return {
    request: (filters: NostrFilter[]): Promise<Result<RawRelayEvent[], NaggError>> => {
      const wantsNotes = filters.some((f) => f.kinds?.includes(1));
      if (wantsNotes) return Promise.resolve(ok(routes.notes ?? []));
      const f = filters[0];
      const authors = f.authors ?? [];
      if (authors.length === 1 && authors[0] === V) return Promise.resolve(ok(routes.viewerLikes ?? []));
      return Promise.resolve(ok(routes.seedLikes ?? []));
    },
  };
}

const NOW = 1_700_000_000_000;
function request(overrides: Partial<FeedPageRequest> = {}): FeedPageRequest {
  return { spec: { kind: 'for-you', viewerPubkey: V }, limit: 20, ...overrides };
}

function rankedAuthors(bundle: { manifest: { elements: string[] }; itemsById: Map<string, { type: 'note'; event: { pubkey: string } } | { type: 'repost' }> }): string[] {
  return bundle.manifest.elements.map((id) => {
    const item = bundle.itemsById.get(id);
    return item && item.type === 'note' ? item.event.pubkey : '';
  });
}

beforeEach(() => __clearRelayForYouCache());

// --- pure: targetAuthorFromReaction ----------------------------------------

describe('targetAuthorFromReaction', () => {
  test('returns the last p tag when an e tag is present', () => {
    const r = asFeedEvent(reaction(V, A, 'evt1'));
    expect(targetAuthorFromReaction(r)).toBe(A);
  });

  test('prefers the LAST p tag (inherited mentions come first)', () => {
    const r = asFeedEvent({ ...reaction(V, A, 'evt1'), tags: [['e', 'evt1'], ['p', B], ['p', A]] });
    expect(targetAuthorFromReaction(r)).toBe(A);
  });

  test('null when there is no e tag (profile-only reaction)', () => {
    const r = asFeedEvent({ ...reaction(V, A, 'evt1'), tags: [['p', A]] });
    expect(targetAuthorFromReaction(r)).toBeNull();
  });

  test('null when there is no p tag', () => {
    const r = asFeedEvent({ ...reaction(V, A, 'evt1'), tags: [['e', 'evt1']] });
    expect(targetAuthorFromReaction(r)).toBeNull();
  });

  test('null for a non-reaction kind', () => {
    expect(targetAuthorFromReaction(asFeedEvent(note(A, 1)))).toBeNull();
  });
});

// --- pure: tallyLikedAuthors -----------------------------------------------

describe('tallyLikedAuthors', () => {
  test('viewer source scores by like COUNT and excludes the viewer', () => {
    const reactions = [
      asFeedEvent(reaction(V, A, 'e1', 10)),
      asFeedEvent(reaction(V, A, 'e2', 20)),
      asFeedEvent(reaction(V, B, 'e3', 15)),
      asFeedEvent(reaction(V, V, 'e4', 30)), // self-like: dropped
    ];
    const out = tallyLikedAuthors(reactions, { source: 'viewer', excludePubkey: V });
    expect(out.map((c) => c.pubkey)).toEqual([A, B]); // A (2) ranks above B (1)
    expect(out[0].score).toBe(2);
    expect(out[0].likeCount).toBe(2);
    expect(out[0].latestLikeAt).toBe(20);
    expect(out.some((c) => c.pubkey === V)).toBe(false);
  });

  test('curated source scores by DISTINCT likers (melting-pot popularity)', () => {
    const reactions = [
      asFeedEvent(reaction(A, E, 'e1')),
      asFeedEvent(reaction(B, E, 'e2')),
      asFeedEvent(reaction(A, E, 'e3')), // same liker again — does not raise distinct score
    ];
    const out = tallyLikedAuthors(reactions, { source: 'curated' });
    expect(out[0].pubkey).toBe(E);
    expect(out[0].score).toBe(2); // A and B = two distinct likers
    expect(out[0].likeCount).toBe(3);
  });
});

describe('distinctTargetAuthors', () => {
  test('counts unique usable targets only', () => {
    const reactions = [
      asFeedEvent(reaction(V, A, 'e1')),
      asFeedEvent(reaction(V, A, 'e2')),
      asFeedEvent(reaction(V, B, 'e3')),
      asFeedEvent({ ...reaction(V, A, 'e4'), tags: [['p', A]] }), // unusable (no e)
    ];
    expect(distinctTargetAuthors(reactions)).toBe(2);
  });
});

// --- pure: mergeCandidates -------------------------------------------------

describe('mergeCandidates', () => {
  const cand = (pubkey: string, score: number, source: CandidateAuthor['source']): CandidateAuthor => ({
    pubkey,
    score,
    likeCount: score,
    likedBy: [],
    latestLikeAt: 0,
    source,
  });

  test('dedupes by pubkey keeping the higher-priority (earlier) group', () => {
    const viewer = [cand(A, 5, 'viewer')];
    const oneHop = [cand(A, 99, 'one-hop'), cand(E, 3, 'one-hop')];
    const out = mergeCandidates([viewer, oneHop], { maxAuthors: 10 });
    const a = out.find((c) => c.pubkey === A)!;
    expect(a.source).toBe('viewer'); // viewer wins despite lower score
    expect(out.map((c) => c.pubkey).sort()).toEqual([A, E].sort());
  });

  test('excludes given pubkeys and caps the count', () => {
    const out = mergeCandidates([[cand(A, 5, 'viewer'), cand(B, 4, 'viewer'), cand(E, 3, 'viewer')]], {
      maxAuthors: 2,
      exclude: [B],
    });
    expect(out.map((c) => c.pubkey)).toEqual([A, E]);
  });
});

// --- pure: rankNotes -------------------------------------------------------

describe('rankNotes', () => {
  test('ranks by affinity then recency, enforcing the per-author cap', () => {
    const candidates: CandidateAuthor[] = [
      { pubkey: A, score: 10, likeCount: 10, likedBy: [], latestLikeAt: 0, source: 'viewer' },
      { pubkey: B, score: 1, likeCount: 1, likedBy: [], latestLikeAt: 0, source: 'viewer' },
    ];
    const notes = [
      asFeedEvent(note(B, 1, 9000)), // high recency but low author affinity
      asFeedEvent(note(A, 1, 100)),
      asFeedEvent(note(A, 2, 200)),
      asFeedEvent(note(A, 3, 300)), // 3rd A note — dropped by cap=2
    ];
    const { rankedIds, eventsById } = rankNotes({ notes, candidates, perAuthorCap: 2 });
    const authors = rankedIds.map((id) => eventsById.get(id)!.pubkey);
    expect(authors).toEqual([A, A, B]); // A's two newest first (affinity), then B
    expect(rankedIds).toHaveLength(3); // A's third note capped out
  });

  test('dedupes notes by id', () => {
    const n = asFeedEvent(note(A, 1));
    const { rankedIds } = rankNotes({
      notes: [n, n],
      candidates: [{ pubkey: A, score: 1, likeCount: 1, likedBy: [], latestLikeAt: 0, source: 'viewer' }],
      perAuthorCap: 5,
    });
    expect(rankedIds).toHaveLength(1);
  });
});

// --- orchestrator: buildRelayForYouFeed ------------------------------------

describe('buildRelayForYouFeed', () => {
  test('returns null without a viewer pubkey', async () => {
    const bundle = await buildRelayForYouFeed({
      connection: routedConnection({}),
      request: { spec: { kind: 'for-you' }, limit: 20 },
      now: NOW,
    });
    expect(bundle).toBeNull();
  });

  test('viewer path: ranks liked authors notes, includes profiles, rank manifest', async () => {
    const connection = routedConnection({
      viewerLikes: [reaction(V, A, 'eA1'), reaction(V, A, 'eA2'), reaction(V, B, 'eB1')],
      seedLikes: [], // one-hop (viewer has <8 authors) returns nothing → candidates stay A,B
      notes: [note(A, 1, 500), note(A, 2, 400), note(B, 1, 900), profile(A, 'Alice'), profile(B, 'Bob')],
    });
    const bundle = await buildRelayForYouFeed({ viewerPubkey: V, connection, request: request(), now: NOW });
    expect(bundle).not.toBeNull();
    expect(bundle!.manifest.orderBy).toBe('rank');
    expect(rankedAuthors(bundle!)).toEqual([A, A, B]); // A affinity 2 > B affinity 1
    expect(bundle!.profiles[A]?.name).toBe('Alice');
    expect(bundle!.stats).toEqual({});
  });

  test('one-hop expansion surfaces authors discovered via the viewer-liked accounts', async () => {
    const connection = routedConnection({
      viewerLikes: [reaction(V, A, 'eA1')], // one author < minAuthors → expand
      seedLikes: [reaction(A, E, 'eE1'), reaction(A, E, 'eE2')], // A likes E
      notes: [note(A, 1), note(E, 1)],
    });
    const bundle = await buildRelayForYouFeed({ viewerPubkey: V, connection, request: request(), now: NOW });
    expect(bundle).not.toBeNull();
    expect(rankedAuthors(bundle!)).toContain(E); // discovered one hop out
  });

  test('cold start: no viewer likes → curated melting pot drives candidates', async () => {
    const connection = routedConnection({
      viewerLikes: [],
      seedLikes: [reaction(A, E, 'eE1'), reaction(B, E, 'eE2')], // curated accounts like E
      notes: [note(E, 1)],
    });
    const bundle = await buildRelayForYouFeed({ viewerPubkey: V, connection, request: request(), now: NOW });
    expect(bundle).not.toBeNull();
    expect(rankedAuthors(bundle!)).toEqual([E]);
  });

  test('returns null when no candidate notes are found', async () => {
    const connection = routedConnection({ viewerLikes: [], seedLikes: [], notes: [] });
    const bundle = await buildRelayForYouFeed({ viewerPubkey: V, connection, request: request(), now: NOW });
    expect(bundle).toBeNull();
  });

  test('pagination slices the cached ranked set without reshuffle and ends cleanly', async () => {
    const connection = routedConnection({
      viewerLikes: [reaction(V, A, 'eA1'), reaction(V, B, 'eB1')],
      seedLikes: [],
      // 1 note each from A and B (per-author cap default 2) → 2 ranked notes total
      notes: [note(A, 1, 800), note(B, 1, 700), profile(A, 'Alice'), profile(B, 'Bob')],
    });
    const page0 = await buildRelayForYouFeed({ viewerPubkey: V, connection, request: request({ limit: 1 }), now: NOW });
    expect(page0!.manifest.elements).toHaveLength(1);
    expect(page0!.cursor).not.toBeNull();

    const page1 = await buildRelayForYouFeed({
      viewerPubkey: V,
      connection,
      request: request({ limit: 1, cursor: page0!.cursor }),
      now: NOW,
    });
    expect(page1!.manifest.elements).toHaveLength(1);
    // No overlap and no reshuffle: page1's item differs from page0's.
    expect(page1!.manifest.elements[0]).not.toBe(page0!.manifest.elements[0]);
    expect(page1!.cursor).toBeNull(); // ranked set exhausted
  });
});
