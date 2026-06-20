import { describe, test, expect } from 'vitest';
import { createNaggClient } from '../src/transport';
import { createNaggTier, createNostrDataLayer, pendingFeedTier } from '../src/facade';

// A canonical FeedResponse (the shape nagg's REST app-view emits) with two notes
// in ranked order [newer, older] so we can assert the facade renders by the
// server's order, not by created_at or insertion accident.
const ID_A = 'a'.repeat(64);
const ID_B = 'b'.repeat(64);
const PUB = 'c'.repeat(64);

function note(id: string, created_at: number) {
  return { type: 'note', event: { id, kind: 1, pubkey: PUB, content: `note ${id}`, tags: [], created_at } };
}

const FEED_PAGE = {
  items: [note(ID_A, 1_700_000_200), note(ID_B, 1_700_000_100)],
  metrics: {
    [ID_A]: { likeCount: 5, repostCount: 2, replyCount: 1, satsZapped: 2100 },
    [ID_B]: { likeCount: 0, repostCount: 0, replyCount: 0, satsZapped: 0 },
  },
  profiles: { [PUB]: { name: 'alice' } },
  quoted: {},
  paginationUntil: 1_700_000_100,
  paginationOffset: 0,
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
    endpoint: 'https://nagg.test/graphql',
    appView: { baseUrl: 'https://nagg.test' },
    transport: 'appview',
    fetchImpl: (async (url: string) => {
      lastUrl = String(url);
      return jsonResponse(body, init);
    }) as unknown as typeof fetch,
  });
  return { client, urlOf: () => lastUrl };
}

describe('NostrDataLayer.getFeedPage — nagg tier end to end', () => {
  test('answers from nagg with an ordered, validated, stats-mapped page', async () => {
    const { client, urlOf } = naggClientReturning(FEED_PAGE);
    const layer = createNostrDataLayer({
      tiers: [createNaggTier({ client }), pendingFeedTier('primal'), pendingFeedTier('relay')],
    });

    const result = await layer.getFeedPage({ spec: { kind: 'for-you', viewerPubkey: PUB } });
    expect(result.isOk()).toBe(true);
    const page = result._unsafeUnwrap();

    expect(page.tier).toBe('nagg');
    // hit the ranked REST app-view route
    expect(urlOf()).toContain('/nostr/feed/ranked');
    // rendered strictly by the server's ranked order
    expect(page.items.map((i) => (i.type === 'note' ? i.event.id : ''))).toEqual([ID_A, ID_B]);
    // metrics mapped onto the NoteStats contract (zaps bridges to 0; sats preserved)
    expect(page.stats[ID_A]).toEqual({ likes: 5, reposts: 2, replies: 1, zaps: 0, satsZapped: 2100 });
    // cursor carries the (created_at, id) page position
    expect(page.cursor).toEqual({ createdAt: 1_700_000_100, id: ID_B });
    expect(page.profiles[PUB]).toEqual({ name: 'alice' });
    expect(page.missingIds).toEqual([]);
  });

  test('prefers the server ordering manifest over deriving from item order', async () => {
    // server returns items [A, B] but a manifest ordering them [B, A] with the
    // created_at semantic — the facade must render by the manifest, not item order.
    const { client } = naggClientReturning({
      ...FEED_PAGE,
      ordering: { orderBy: 'created_at', elements: [ID_B, ID_A] },
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
    const { client, urlOf } = naggClientReturning(FEED_PAGE);
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });
    const result = await layer.getFeedPage({ spec: { kind: 'user', pubkey: PUB } });
    expect(result.isOk()).toBe(true);
    expect(urlOf()).toContain('/nostr/feed/user');
    expect(urlOf()).toContain('pubkey=' + PUB);
  });

  test('following-recent GETs /nostr/feed with the explicit author list', async () => {
    const { client, urlOf } = naggClientReturning(FEED_PAGE);
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });
    const result = await layer.getFeedPage({ spec: { kind: 'following-recent', authors: [PUB, ID_A] } });
    expect(result.isOk()).toBe(true);
    expect(urlOf()).toContain('/nostr/feed');
    expect(urlOf()).toContain('pubkeys=');
  });

  test('a malformed nagg response is a tier failure (schema), not a crash', async () => {
    // missing required `metrics`/`profiles` → NaggFeedPageSchema rejects
    const { client } = naggClientReturning({ items: [], paginationUntil: 0, paginationOffset: 0 });
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });

    const result = await layer.getFeedPage({ spec: { kind: 'for-you' } });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().attempts[0]).toMatchObject({ tier: 'nagg', outcome: 'failed' });
  });
});
