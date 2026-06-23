import { describe, test, expect } from 'vitest';
import { ok, type Result } from 'neverthrow';
import {
  demuxPrimalFeed,
  demuxPrimalThread,
  demuxPrimalProfileStats,
  demuxPrimalSocialGraph,
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

  test('reconstructs a repost: original content inline in the kind-6, keyed by the original id', () => {
    const ID_ORIG = 'd'.repeat(64);
    const ID_REPOST = 'e'.repeat(64);
    const REPOSTER = 'f'.repeat(64);
    const original = {
      id: ID_ORIG,
      pubkey: PUB,
      kind: 1,
      content: 'the reposted note',
      tags: [],
      created_at: 1_700_000_050,
    };
    const bundle = demuxPrimalFeed([
      // Primal inlines the original note as stringified JSON in the repost content.
      {
        id: ID_REPOST,
        pubkey: REPOSTER,
        kind: 6,
        content: JSON.stringify(original),
        tags: [['e', ID_ORIG]],
        created_at: 1_700_000_300,
      },
      { kind: 10_000_113, content: JSON.stringify({ order_by: 'rank', elements: [ID_ORIG] }) },
    ]);

    // Item is keyed by the ORIGINAL note id, not the kind-6 event id.
    expect([...bundle.itemsById.keys()]).toEqual([ID_ORIG]);
    const item = bundle.itemsById.get(ID_ORIG)!;
    expect(item.type).toBe('repost');
    if (item.type !== 'repost') throw new Error('expected repost');
    expect(item.originalEventId).toBe(ID_ORIG);
    expect(item.originalEvent?.content).toBe('the reposted note');
    expect(item.repostEvent.id).toBe(ID_REPOST);
    expect(item.reposters?.map((r) => r.pubkey)).toEqual([REPOSTER]);
    // Manifest renders the item even though feedRange referenced the original id.
    expect(bundle.manifest.elements).toEqual([ID_ORIG]);
    // Cursor uses the repost's feed-position timestamp (kind-6 created_at).
    expect(bundle.cursor).toEqual({ createdAt: 1_700_000_300, id: ID_ORIG });
  });

  test('collapses multiple reposts of the same note into one item with many reposters', () => {
    const ID_ORIG = 'd'.repeat(64);
    const original = { id: ID_ORIG, pubkey: PUB, kind: 1, content: 'hi', tags: [], created_at: 1 };
    const mk = (repostId: string, who: string, at: number): RawPrimalEvent => ({
      id: repostId,
      pubkey: who,
      kind: 6,
      content: JSON.stringify(original),
      tags: [['e', ID_ORIG]],
      created_at: at,
    });
    const bundle = demuxPrimalFeed([
      mk('1'.repeat(64), 'a'.repeat(64), 100),
      mk('2'.repeat(64), 'b'.repeat(64), 200),
    ]);
    expect([...bundle.itemsById.keys()]).toEqual([ID_ORIG]);
    const item = bundle.itemsById.get(ID_ORIG)!;
    if (item.type !== 'repost') throw new Error('expected repost');
    expect(item.reposters?.map((r) => r.pubkey).sort()).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
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

describe('demuxPrimalProfileStats — user_profile batch → profile header', () => {
  test('maps kind-0 metadata + the USER_PROFILE (10000105) counts and time_joined', () => {
    const bundle = demuxPrimalProfileStats(
      [
        {
          pubkey: PUB,
          kind: 0,
          content: JSON.stringify({ name: 'alice', about: 'hi', nip05: 'a@b.c' }),
          created_at: 1_700_000_000,
        },
        {
          kind: 10_000_105,
          content: JSON.stringify({
            pubkey: PUB,
            follows_count: 42,
            followers_count: 100,
            note_count: 7,
            time_joined: 1_600_000_000,
          }),
        },
      ],
      PUB
    );
    expect(bundle.pubkey).toBe(PUB);
    expect(bundle.metadata).toMatchObject({ name: 'alice', about: 'hi', nip05: 'a@b.c' });
    expect(bundle.followingCount).toBe(42);
    expect(bundle.followersCount).toBe(100);
    expect(bundle.noteCount).toBe(7);
    expect(bundle.joinedAt).toBe(1_600_000_000);
  });

  test('null time_joined is omitted, not coerced to 0', () => {
    const bundle = demuxPrimalProfileStats(
      [{ kind: 10_000_105, content: JSON.stringify({ pubkey: PUB, followers_count: 3, time_joined: null }) }],
      PUB
    );
    expect(bundle.followersCount).toBe(3);
    expect(bundle.joinedAt).toBeUndefined();
  });
});

describe('demuxPrimalSocialGraph — contact_list → follows + bundled profiles', () => {
  test('parses the kind-3 follow set and layers followed users’ kind-0', () => {
    const FOLLOW_A = '1'.repeat(64);
    const FOLLOW_B = '2'.repeat(64);
    const graph = demuxPrimalSocialGraph(
      [
        {
          id: 'k3'.padEnd(64, '0'),
          pubkey: PUB,
          kind: 3,
          content: '',
          tags: [['p', FOLLOW_A], ['p', FOLLOW_B]],
          created_at: 1_700_000_500,
        },
        { pubkey: FOLLOW_A, kind: 0, content: JSON.stringify({ name: 'bob', picture: 'http://x/b.png' }) },
      ],
      PUB
    );
    expect(graph.pubkey).toBe(PUB);
    expect(graph.follows.sort()).toEqual([FOLLOW_A, FOLLOW_B].sort());
    expect(graph.contactsUpdatedAt).toBe(1_700_000_500);
    expect(graph.profiles[FOLLOW_A]).toEqual({ name: 'bob', picture: 'http://x/b.png' });
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
    // following-recent has no Primal directive wired → falls through to the floor.
    const outcome = await tier.feedPage!({ spec: { kind: 'following-recent', authors: [PUB] } });
    expect(outcome.kind).toBe('unsupported');
  });

  test('for-you maps to a valid Primal feed directive (global-trending)', async () => {
    let captured: { verb: string; params: Record<string, unknown> } | undefined;
    const tier = createPrimalTier({
      connection: {
        request: (req) => {
          captured = req;
          return Promise.resolve(ok(BATCH));
        },
      },
    });
    await tier.feedPage!({ spec: { kind: 'for-you', viewerPubkey: PUB } });
    expect(captured?.verb).toBe('mega_feed_directive');
    expect(JSON.parse(String(captured?.params.spec))).toMatchObject({ id: 'global-trending', kind: 'notes' });
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

describe('demuxPrimalThread — replies survive a non-reply feedRange', () => {
  const ROOT = 'd'.repeat(64);
  const R1 = 'e'.repeat(64);
  const R2 = 'f'.repeat(64);

  test('renders every reply even when feedRange lists only the root', () => {
    // Reproduces the live bug: Primal thread_view streams the reply notes, but
    // its feedRange points at the primary note / pagination window — NOT the
    // replies. The old manifest filtered replies through it and dropped them.
    const batch: RawPrimalEvent[] = [
      { id: ROOT, pubkey: PUB, kind: 1, content: 'root', tags: [], created_at: 1_700_000_000 },
      { id: R1, pubkey: PUB, kind: 1, content: 'reply 1', tags: [], created_at: 1_700_000_100 },
      { id: R2, pubkey: PUB, kind: 1, content: 'reply 2', tags: [], created_at: 1_700_000_200 },
      { kind: 10_000_113, content: JSON.stringify({ order_by: 'rank', elements: [ROOT] }) },
    ];

    const bundle = demuxPrimalThread(batch, ROOT);
    expect(bundle).not.toBeNull();
    expect([...bundle!.itemsById.keys()].sort()).toEqual([R1, R2].sort());
    // Both replies are in the manifest (root excluded), so they actually render.
    expect(bundle!.manifest.elements.sort()).toEqual([R1, R2].sort());
  });
});
