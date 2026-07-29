import { describe, test, expect } from 'vitest';
import { ok, type Result } from 'neverthrow';
import { createNaggClient } from '../src/transport';
import { createNaggTier, createNostrDataLayer, pendingFeedTier } from '../src/facade';
import { createPrimalTier, type PrimalConnection, type RawPrimalEvent } from '../src/facade/primal';
import { createRelayTier, type RelayConnection, type RawRelayEvent } from '../src/facade/relay';
import type { NaggError } from '../src/errors';

const ROOT = 'a'.repeat(64);
const R1 = 'b'.repeat(64);
const R2 = 'e'.repeat(64);
const PUB = 'c'.repeat(64);

function event(id: string, created_at: number) {
  return { id, kind: 1, pubkey: PUB, content: `e ${id}`, tags: [], created_at };
}

// v2 envelope: order[0] is the root id, the rest are the ranked reply ids.
// Zero-valued aggregates are omitted server-side (R2 has none at all).
const THREAD_ENVELOPE = {
  order: [ROOT, R1, R2],
  orderBy: 'rank',
  events: [
    event(ROOT, 1_700_000_000),
    event(R1, 1_700_000_100),
    event(R2, 1_700_000_200),
    {
      id: 'd'.repeat(64),
      kind: 0,
      pubkey: PUB,
      content: JSON.stringify({ name: 'alice' }),
      tags: [],
      created_at: 1_700_000_000,
    },
  ],
  aggregates: {
    [ROOT]: { k7_e: { actors: 9 }, k1_1111_e_reply: { sources: 2 } },
    [R1]: { k7_e: { actors: 1 } },
  },
};

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.ok === false ? 'Server Error' : 'OK',
    json: async () => body,
  } as unknown as Response;
}

function naggClientReturning(body: unknown, init?: { ok?: boolean; status?: number }) {
  let lastUrl = '';
  const client = createNaggClient({
    appView: { baseUrl: 'https://nagg.test' },
    fetchImpl: (async (url: string) => {
      lastUrl = String(url);
      return jsonResponse(body, init);
    }) as unknown as typeof fetch,
  });
  return { client, urlOf: () => lastUrl };
}

describe('NostrDataLayer.getThread — nagg tier', () => {
  test('returns the root plus manifest-ordered replies, stats mapped', async () => {
    const { client, urlOf } = naggClientReturning(THREAD_ENVELOPE);
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });

    const result = await layer.getThread({ noteId: ROOT });
    expect(result.isOk()).toBe(true);
    const thread = result._unsafeUnwrap();

    expect(urlOf()).toContain('/nostr/thread');
    expect(thread.tier).toBe('nagg');
    expect(thread.root.type === 'note' && thread.root.event.id).toBe(ROOT);
    expect(thread.replies.map((r) => (r.type === 'note' ? r.event.id : ''))).toEqual([R1, R2]);
    expect(thread.stats[ROOT]).toEqual({ likes: 9, reposts: 0, replies: 2, zaps: 0, satsZapped: 0 });
  });

  test('an empty thread with null aggregates still answers (the 0/42 fix)', async () => {
    // A root with no replies/stats: Go serializes nil maps/slices as JSON null.
    // This must parse as an empty thread, NOT fail validation and silently fall
    // through the tier.
    const { client } = naggClientReturning({
      order: [ROOT],
      orderBy: 'rank',
      events: [event(ROOT, 1_700_000_000)],
      aggregates: null,
    });
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });
    const result = await layer.getThread({ noteId: ROOT });
    expect(result.isOk()).toBe(true);
    const thread = result._unsafeUnwrap();
    expect(thread.tier).toBe('nagg'); // gold tier serves it, no fallthrough
    expect(thread.root.type === 'note' && thread.root.event.id).toBe(ROOT);
    expect(thread.replies).toEqual([]);
    // Rendered ids get zero-defaulted stats (aggregates omit zero values).
    expect(thread.stats[ROOT]).toEqual({ likes: 0, reposts: 0, replies: 0, zaps: 0, satsZapped: 0 });
  });

  test('a feed-only tier is skipped for thread reads (not in the attempt trail)', async () => {
    const { client } = naggClientReturning({}, { ok: false, status: 503 });
    const layer = createNostrDataLayer({
      // pendingFeedTier implements feedPage only → must NOT appear when resolving a thread
      tiers: [pendingFeedTier('primal'), createNaggTier({ client })],
    });

    const result = await layer.getThread({ noteId: ROOT });
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.attempts.map((a) => a.tier)).toEqual(['nagg']);
  });
});

describe('thread parity — Primal and relay tiers', () => {
  const primalBatch: RawPrimalEvent[] = [
    { id: ROOT, pubkey: PUB, kind: 1, content: 'root', tags: [], created_at: 1_700_000_000 },
    { id: R1, pubkey: PUB, kind: 1, content: 'r1', tags: [], created_at: 1_700_000_100 },
    { id: R2, pubkey: PUB, kind: 1, content: 'r2', tags: [], created_at: 1_700_000_200 },
    { kind: 10_000_113, content: JSON.stringify({ order_by: 'rank', elements: [ROOT, R1, R2] }) },
  ];

  function fakePrimal(events: RawPrimalEvent[]): PrimalConnection {
    return { request: (): Promise<Result<RawPrimalEvent[], NaggError>> => Promise.resolve(ok(events)) };
  }
  function fakeRelay(events: RawRelayEvent[]): RelayConnection {
    return { request: (): Promise<Result<RawRelayEvent[], NaggError>> => Promise.resolve(ok(events)) };
  }

  test('Primal serves the thread when nagg cannot; root excluded from replies', async () => {
    const layer = createNostrDataLayer({
      tiers: [pendingFeedTier('nagg'), createPrimalTier({ connection: fakePrimal(primalBatch) })],
    });
    const result = await layer.getThread({ noteId: ROOT });
    expect(result.isOk()).toBe(true);
    const thread = result._unsafeUnwrap();
    expect(thread.tier).toBe('primal');
    expect(thread.root.type === 'note' && thread.root.event.id).toBe(ROOT);
    // manifest had [ROOT, R1, R2]; root filtered out of replies
    expect(thread.replies.map((r) => (r.type === 'note' ? r.event.id : ''))).toEqual([R1, R2]);
  });

  test('relay floor serves the thread (root by id + #e replies, newest-first)', async () => {
    const relayBatch: RawRelayEvent[] = [
      { id: ROOT, pubkey: PUB, kind: 1, content: 'root', tags: [], created_at: 1_700_000_000 },
      { id: R1, pubkey: PUB, kind: 1, content: 'r1', tags: [['e', ROOT]], created_at: 1_700_000_100 },
      { id: R2, pubkey: PUB, kind: 1, content: 'r2', tags: [['e', ROOT]], created_at: 1_700_000_200 },
    ];
    const layer = createNostrDataLayer({
      tiers: [pendingFeedTier('nagg'), createRelayTier({ connection: fakeRelay(relayBatch) })],
    });
    const result = await layer.getThread({ noteId: ROOT });
    expect(result.isOk()).toBe(true);
    const thread = result._unsafeUnwrap();
    expect(thread.tier).toBe('relay');
    expect(thread.root.type === 'note' && thread.root.event.id).toBe(ROOT);
    expect(thread.replies.map((r) => (r.type === 'note' ? r.event.id : ''))).toEqual([R2, R1]); // newest-first
    expect(thread.stats).toEqual({}); // no engagement on the floor
  });
});

// ---------------------------------------------------------------------------
// Thread contract v2: paging params, hasMore, extras, knownReplyIds, OP pin
// ---------------------------------------------------------------------------

describe('nagg thread — paging params and truthful hasMore', () => {
  test('forwards sort/viewer/offset/replyLimit/candidateLimit/rankedLimit to the app-view', async () => {
    const { client, urlOf } = naggClientReturning({ ...THREAD_ENVELOPE, total: 2 });
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });

    await layer.getThread({
      noteId: ROOT,
      viewerPubkey: PUB,
      sort: 'relevant',
      offset: 10,
      replyLimit: 10,
    });
    const url = urlOf();
    expect(url).toContain('/nostr/thread');
    expect(url).toContain('sort=relevant');
    expect(url).toContain(`viewer=${PUB}`);
    expect(url).toContain('offset=10');
    expect(url).toContain('replyLimit=10');
    expect(url).toContain('candidateLimit=100');
    expect(url).toContain('rankedLimit=50');
  });

  test('hasMore/nextOffset ride the envelope cursor; absent cursor = exhausted', async () => {
    const paged = naggClientReturning({ ...THREAD_ENVELOPE, total: 40, cursor: '0|2' });
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client: paged.client })] });
    const thread = (await layer.getThread({ noteId: ROOT }))._unsafeUnwrap();
    expect(thread.hasMore).toBe(true);
    expect(thread.nextOffset).toBe(2);

    const lastPage = naggClientReturning({ ...THREAD_ENVELOPE, total: 2 });
    const layer2 = createNostrDataLayer({ tiers: [createNaggTier({ client: lastPage.client })] });
    const done = (await layer2.getThread({ noteId: ROOT }))._unsafeUnwrap();
    expect(done.hasMore).toBe(false);
    expect(done.nextOffset).toBeUndefined();
  });

  test('off-manifest hydration lands in extras (and knownReplyIds), never in replies', async () => {
    const EXTRA = '7'.repeat(64);
    const envelope = {
      ...THREAD_ENVELOPE,
      events: [...THREAD_ENVELOPE.events, { ...event(EXTRA, 1_700_000_300), tags: [['e', ROOT, '', 'root']] }],
      total: 3,
      cursor: '0|2',
    };
    const { client } = naggClientReturning(envelope);
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });
    const thread = (await layer.getThread({ noteId: ROOT }))._unsafeUnwrap();

    expect(thread.replies.map((r) => (r.type === 'note' ? r.event.id : ''))).toEqual([R1, R2]);
    expect(thread.extras.map((r) => (r.type === 'note' ? r.event.id : ''))).toEqual([EXTRA]);
    expect([...thread.knownReplyIds].sort()).toEqual([R1, R2, EXTRA].sort());
    // Extras are cached for instant tap-through.
    expect(layer.cache.getNote(EXTRA)?.id).toBe(EXTRA);
  });
});

describe('OP-first partition across tiers (relevant sort only)', () => {
  const OP = '1'.repeat(64);
  const OTHER = '2'.repeat(64);
  const OP_DIRECT = '3'.repeat(64);
  const OP_NESTED = '4'.repeat(64);
  const OTHER_R = '5'.repeat(64);

  // Relay batch: root by OP; a newer reply by OTHER; an older DIRECT reply by
  // OP; and a nested OP reply (to OTHER_R, only root-marker context tag).
  const relayBatch: RawRelayEvent[] = [
    { id: ROOT, pubkey: OP, kind: 1, content: 'root', tags: [], created_at: 1_700_000_000 },
    { id: OTHER_R, pubkey: OTHER, kind: 1, content: 'r', tags: [['e', ROOT]], created_at: 1_700_000_300 },
    { id: OP_DIRECT, pubkey: OP, kind: 1, content: 'op', tags: [['e', ROOT]], created_at: 1_700_000_100 },
    {
      id: OP_NESTED,
      pubkey: OP,
      kind: 1,
      content: 'op nested',
      tags: [
        ['e', ROOT, '', 'root'],
        ['e', OTHER_R, '', 'reply'],
      ],
      created_at: 1_700_000_400,
    },
  ];

  function fakeRelay(events: RawRelayEvent[]): RelayConnection {
    return { request: (): Promise<Result<RawRelayEvent[], NaggError>> => Promise.resolve(ok(events)) };
  }

  test('relay-served relevant thread pins the OP direct reply first; nested OP replies stay put', async () => {
    const layer = createNostrDataLayer({
      tiers: [pendingFeedTier('nagg'), createRelayTier({ connection: fakeRelay(relayBatch) })],
    });
    const thread = (await layer.getThread({ noteId: ROOT }))._unsafeUnwrap();
    // Recency order would be [OP_NESTED, OTHER_R, OP_DIRECT]; the pin moves
    // ONLY the direct OP reply to the front, keeping relative order elsewhere.
    expect(thread.replies.map((r) => (r.type === 'note' ? r.event.id : ''))).toEqual([
      OP_DIRECT,
      OP_NESTED,
      OTHER_R,
    ]);
    expect(thread.hasMore).toBe(false); // single-shot full thread — no fake "more"
  });

  test('an explicit sort stays literal — no OP pin under sort:"new"', async () => {
    const layer = createNostrDataLayer({
      tiers: [pendingFeedTier('nagg'), createRelayTier({ connection: fakeRelay(relayBatch) })],
    });
    const thread = (await layer.getThread({ noteId: ROOT, sort: 'new' }))._unsafeUnwrap();
    expect(thread.replies.map((r) => (r.type === 'note' ? r.event.id : ''))).toEqual([
      OP_NESTED,
      OTHER_R,
      OP_DIRECT,
    ]);
  });

  test('nagg manifest already leads with the OP block — the partition is a byte-identical no-op', async () => {
    // Server order: OP direct replies first, then others (what nagg emits for
    // sort=relevant). Re-partitioning client-side must not move anything.
    const envelope = {
      order: [ROOT, OP_DIRECT, OTHER_R],
      orderBy: 'rank',
      events: [
        { id: ROOT, kind: 1, pubkey: OP, content: 'root', tags: [], created_at: 1_700_000_000 },
        { id: OP_DIRECT, kind: 1, pubkey: OP, content: 'op', tags: [['e', ROOT, '', 'root']], created_at: 1_700_000_100 },
        { id: OTHER_R, kind: 1, pubkey: OTHER, content: 'r', tags: [['e', ROOT, '', 'root']], created_at: 1_700_000_300 },
      ],
      aggregates: {},
      total: 2,
    };
    const { client } = naggClientReturning(envelope);
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });
    const thread = (await layer.getThread({ noteId: ROOT, sort: 'relevant' }))._unsafeUnwrap();
    expect(thread.replies.map((r) => (r.type === 'note' ? r.event.id : ''))).toEqual([OP_DIRECT, OTHER_R]);
  });
});
