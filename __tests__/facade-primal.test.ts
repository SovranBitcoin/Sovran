import { describe, test, expect } from 'vitest';
import { ok, type Result } from 'neverthrow';
import {
  demuxPrimalFeed,
  createPrimalTier,
  createPrimalWebSocketConnection,
  type PrimalConnection,
  type RawPrimalEvent,
} from '../src/facade/primal';
import { createNostrDataLayer, pendingFeedTier } from '../src/facade';
import type { NaggError } from '../src/errors';

const ID_A = 'a'.repeat(64);
const ID_B = 'b'.repeat(64);
const PUB = 'c'.repeat(64);

// A representative Primal batch: two notes, a profile, and the synthetic
// stats / actions / FeedRange events that carry their payload as JSON content.
const BATCH: RawPrimalEvent[] = [
  { id: ID_B, pubkey: PUB, kind: 1, content: 'older', tags: [], created_at: 1_700_000_100 },
  { id: ID_A, pubkey: PUB, kind: 1, content: 'newer', tags: [], created_at: 1_700_000_200 },
  { pubkey: PUB, kind: 0, content: JSON.stringify({ name: 'alice', picture: 'http://x/a.png' }) },
  {
    kind: 10_000_100,
    content: JSON.stringify({ event_id: ID_A, likes: 5, reposts: 2, replies: 1, zaps: 3, satszapped: 2100 }),
  },
  {
    kind: 10_000_115,
    content: JSON.stringify({ event_id: ID_A, liked: true, reposted: false, replied: false, zapped: true }),
  },
  { kind: 10_000_113, content: JSON.stringify({ order_by: 'rank', elements: [ID_A, ID_B] }) },
];

describe('demuxPrimalFeed — Primal batch → contract bundle', () => {
  test('demuxes notes, profiles, stats, actions, and the manifest', () => {
    const bundle = demuxPrimalFeed(BATCH);

    expect([...bundle.itemsById.keys()].sort()).toEqual([ID_A, ID_B].sort());
    expect(bundle.manifest).toEqual({ orderBy: 'rank', elements: [ID_A, ID_B] });
    expect(bundle.stats[ID_A]).toEqual({ likes: 5, reposts: 2, replies: 1, zaps: 3, satsZapped: 2100 });
    expect(bundle.actions?.[ID_A]).toEqual({
      liked: true,
      reposted: false,
      replied: false,
      zapped: true,
      bookmarked: false,
    });
    expect(bundle.profiles[PUB]).toEqual({ name: 'alice', picture: 'http://x/a.png' });
    // cursor = oldest rendered item's (created_at, id)
    expect(bundle.cursor).toEqual({ createdAt: 1_700_000_100, id: ID_B });
  });

  test('synthesizes a recency manifest when Primal sends no FeedRange', () => {
    const noRange = BATCH.filter((e) => e.kind !== 10_000_113);
    const bundle = demuxPrimalFeed(noRange);
    // newest-first by created_at
    expect(bundle.manifest.orderBy).toBe('created_at');
    expect(bundle.manifest.elements).toEqual([ID_A, ID_B]);
  });

  test('skips a synthetic event with malformed content instead of crashing', () => {
    const bundle = demuxPrimalFeed([
      ...BATCH,
      { kind: 10_000_100, content: '{not json' },
      { kind: 10_000_115, content: JSON.stringify({ missing: 'event_id' }) },
    ]);
    // original valid stats survive; the malformed ones are dropped
    expect(Object.keys(bundle.stats)).toEqual([ID_A]);
  });
});

describe('Primal tier through the facade', () => {
  function fakeConnection(events: RawPrimalEvent[]): PrimalConnection {
    return {
      request(): Promise<Result<RawPrimalEvent[], NaggError>> {
        return Promise.resolve(ok(events));
      },
    };
  }

  test('Primal answers For-You when nagg cannot (fallthrough to tier 2)', async () => {
    const layer = createNostrDataLayer({
      tiers: [
        pendingFeedTier('nagg'), // nagg unsupported here → fall through
        createPrimalTier({ connection: fakeConnection(BATCH) }),
        pendingFeedTier('relay'),
      ],
    });

    const result = await layer.getFeedPage({ spec: { kind: 'for-you', viewerPubkey: PUB } });
    expect(result.isOk()).toBe(true);
    const page = result._unsafeUnwrap();
    expect(page.tier).toBe('primal');
    expect(page.items.map((i) => (i.type === 'note' ? i.event.id : ''))).toEqual([ID_A, ID_B]);
    expect(page.actions?.[ID_A]?.liked).toBe(true);
  });

  test('a spec Primal cannot serve is `unsupported`, not a failure', async () => {
    const tier = createPrimalTier({ connection: fakeConnection(BATCH) });
    const outcome = await tier.feedPage!({ spec: { kind: 'following-popular', viewerPubkey: PUB } });
    expect(outcome.kind).toBe('unsupported');
  });
});

describe('Primal WebSocket connection — protocol plumbing', () => {
  // A fake browser-style WebSocket that replays a scripted EVENT/EOSE sequence.
  class FakeWebSocket {
    onopen: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onclose: ((ev: unknown) => void) | null = null;
    sent: string[] = [];
    constructor(public url: string) {
      queueMicrotask(() => this.onopen?.({}));
    }
    send(data: string) {
      this.sent.push(data);
      const [, subId] = JSON.parse(data) as [string, string];
      queueMicrotask(() => {
        for (const ev of BATCH) this.onmessage?.({ data: JSON.stringify(['EVENT', subId, ev]) });
        this.onmessage?.({ data: JSON.stringify(['EOSE', subId]) });
      });
    }
    close() {
      this.onclose?.({});
    }
  }

  test('sends a cache REQ and collects events until EOSE', async () => {
    const connection = createPrimalWebSocketConnection({
      url: 'wss://cache.test',
      WebSocketImpl: FakeWebSocket as unknown as new (url: string) => never,
    });

    const result = await connection.request({ verb: 'mega_feed_directive', params: { limit: 30 } });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(BATCH.length);
  });
});
