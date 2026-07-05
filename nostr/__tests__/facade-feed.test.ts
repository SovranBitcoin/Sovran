import { describe, test, expect } from 'vitest';
import { createNaggClient } from '../src/transport';
import { createNaggTier, createNostrDataLayer, pendingFeedTier } from '../src/facade';

// A v2 envelope (the ONE shape nagg's REST app-view emits) with two notes in
// ranked order [newer, older] so we can assert the facade renders by the
// server's order, not by created_at or insertion accident.
const ID_A = 'a'.repeat(64);
const ID_B = 'b'.repeat(64);
const PUB = 'c'.repeat(64);
const PROFILE_ID = 'd'.repeat(64);

function note(id: string, created_at: number) {
  return { id, kind: 1, pubkey: PUB, content: `note ${id}`, tags: [], created_at };
}

const FEED_ENVELOPE = {
  order: [ID_A, ID_B],
  orderBy: 'rank',
  events: [
    note(ID_A, 1_700_000_200),
    note(ID_B, 1_700_000_100),
    {
      id: PROFILE_ID,
      kind: 0,
      pubkey: PUB,
      content: JSON.stringify({ name: 'alice' }),
      tags: [],
      created_at: 1_700_000_000,
    },
  ],
  // Zero values are omitted server-side: ID_B carries no aggregates at all.
  aggregates: {
    [ID_A]: {
      k7_e: { actors: 5 },
      k6_16_e: { actors: 2 },
      k1_1111_e_reply: { sources: 1 },
      k9735_e: { sources: 3, value_total: 2100 },
    },
  },
  cursor: '1700000100|0',
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

describe('NostrDataLayer.getFeedPage — nagg tier end to end', () => {
  test('answers from nagg with an ordered, validated, stats-mapped page', async () => {
    const { client, urlOf } = naggClientReturning(FEED_ENVELOPE);
    const layer = createNostrDataLayer({
      tiers: [createNaggTier({ client }), pendingFeedTier('primal'), pendingFeedTier('relay')],
    });

    const result = await layer.getFeedPage({ spec: { kind: 'for-you', viewerPubkey: PUB } });
    expect(result.isOk()).toBe(true);
    const page = result._unsafeUnwrap();

    expect(page.tier).toBe('nagg');
    // hit the ranked REST app-view route
    expect(urlOf()).toContain('/nostr/feed/ranked');
    // rendered strictly by the server's `order`
    expect(page.items.map((i) => (i.type === 'note' ? i.event.id : ''))).toEqual([ID_A, ID_B]);
    // aggregates mapped onto the NoteStats contract (v2 carries a discrete zap count)
    expect(page.stats[ID_A]).toEqual({ likes: 5, reposts: 2, replies: 1, zaps: 3, satsZapped: 2100 });
    // zero-omitted aggregates default to 0 for rendered ids
    expect(page.stats[ID_B]).toEqual({ likes: 0, reposts: 0, replies: 0, zaps: 0, satsZapped: 0 });
    // cursor carries the (until, id) page position parsed from "<until>|<offset>"
    expect(page.cursor).toEqual({ createdAt: 1_700_000_100, id: ID_B });
    // profiles reconstructed from the hydrated kind-0
    expect(page.profiles[PUB]).toEqual({ name: 'alice' });
    expect(page.missingIds).toEqual([]);
  });

  test('renders by the server order even when events arrive shuffled', async () => {
    // Same events, but `order` says [B, A] with the created_at semantic — the
    // facade must render by the manifest, not by events[] position.
    const { client } = naggClientReturning({
      ...FEED_ENVELOPE,
      order: [ID_B, ID_A],
      orderBy: 'created_at',
    });
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });

    const result = await layer.getFeedPage({ spec: { kind: 'for-you', viewerPubkey: PUB } });
    const page = result._unsafeUnwrap();
    expect(page.items.map((i) => (i.type === 'note' ? i.event.id : ''))).toEqual([ID_B, ID_A]);
  });

  test('falls through to the next tier when nagg errors, then exhausts honestly', async () => {
    const { client } = naggClientReturning({}, { ok: false, status: 503 });
    const layer = createNostrDataLayer({
      tiers: [createNaggTier({ client }), pendingFeedTier('primal'), pendingFeedTier('relay')],
    });

    const result = await layer.getFeedPage({ spec: { kind: 'for-you' } });
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe('all_tiers_exhausted');
    // nagg failed (http), primal + relay are not yet implemented (unsupported)
    expect(error.attempts.map((a) => `${a.tier}:${a.outcome}`)).toEqual([
      'nagg:failed',
      'primal:unsupported',
      'relay:unsupported',
    ]);
  });

  test('user feed hits /nostr/feed/user with the author', async () => {
    const { client, urlOf } = naggClientReturning(FEED_ENVELOPE);
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });
    const result = await layer.getFeedPage({ spec: { kind: 'user', pubkey: PUB } });
    expect(result.isOk()).toBe(true);
    expect(urlOf()).toContain('/nostr/feed/user');
    expect(urlOf()).toContain('pubkey=' + PUB);
  });

  test('following-recent GETs /nostr/feed with the explicit author list', async () => {
    const { client, urlOf } = naggClientReturning(FEED_ENVELOPE);
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });
    const result = await layer.getFeedPage({ spec: { kind: 'following-recent', authors: [PUB, ID_A] } });
    expect(result.isOk()).toBe(true);
    expect(urlOf()).toContain('/nostr/feed');
    expect(urlOf()).toContain('pubkeys=');
  });

  test('a malformed nagg response is a tier failure (schema), not a crash', async () => {
    // `order` must be an array (or null); a wrong-typed core field → the
    // envelope schema rejects. (Null order/events/aggregates are NOT malformed
    // — they default to empty — see the null-tolerance test below.)
    const { client } = naggClientReturning({ order: 42, orderBy: 'rank', events: [], aggregates: {} });
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });

    const result = await layer.getFeedPage({ spec: { kind: 'for-you' } });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().attempts[0]).toMatchObject({ tier: 'nagg', outcome: 'failed' });
  });

  test('null aggregates (Go nil → JSON null) parse as empty, not a failure', async () => {
    const { client } = naggClientReturning({
      ...FEED_ENVELOPE,
      events: FEED_ENVELOPE.events.filter((e) => e.kind !== 0),
      aggregates: null,
    });
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });
    const result = await layer.getFeedPage({ spec: { kind: 'for-you', viewerPubkey: PUB } });
    expect(result.isOk()).toBe(true);
    const page = result._unsafeUnwrap();
    expect(page.tier).toBe('nagg');
    expect(page.items.map((i) => (i.type === 'note' ? i.event.id : ''))).toEqual([ID_A, ID_B]);
    // rendered ids still get zero-defaulted stats; no profiles were hydrated
    expect(page.stats[ID_A]).toEqual({ likes: 0, reposts: 0, replies: 0, zaps: 0, satsZapped: 0 });
    expect(page.profiles).toEqual({});
  });

  test('write-through: a feed read populates the shared entity cache', async () => {
    const { client } = naggClientReturning(FEED_ENVELOPE);
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });

    // Cold cache: nothing about these entities yet.
    expect(layer.cache.getNote(ID_A)).toBeUndefined();

    const result = await layer.getFeedPage({ spec: { kind: 'for-you', viewerPubkey: PUB } });
    expect(result.isOk()).toBe(true);

    // A later, different surface (a thread on ID_A, a profile page for PUB) now
    // serves these instantly from the cache — no second fetch needed.
    expect(layer.cache.getNote(ID_A)?.content).toBe(`note ${ID_A}`);
    expect(layer.cache.getNoteStats(ID_A)).toMatchObject({
      likes: 5,
      reposts: 2,
      replies: 1,
      zaps: 3,
      satsZapped: 2100,
    });
    expect(layer.cache.getProfile(PUB)?.name).toBe('alice');
  });
});
