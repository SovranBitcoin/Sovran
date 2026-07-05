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
