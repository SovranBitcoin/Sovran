import { describe, test, expect } from 'vitest';
import {
  demuxPrimalProfileStats,
  demuxPrimalSocialGraph,
  createPrimalWebSocketConnection,
  type RawPrimalEvent,
} from '../src/facade/primal';
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
    expect(bundle.joinedAtSec).toBe(1_600_000_000);
  });

  test('null time_joined is omitted, not coerced to 0', () => {
    const bundle = demuxPrimalProfileStats(
      [{ kind: 10_000_105, content: JSON.stringify({ pubkey: PUB, followers_count: 3, time_joined: null }) }],
      PUB
    );
    expect(bundle.followersCount).toBe(3);
    expect(bundle.joinedAtSec).toBeUndefined();
  });
});

describe('demuxPrimalSocialGraph — contact_list → follows + bundled profiles', () => {
  test('parses the kind-3 follow set and layers followed users’ kind-0', () => {
    const FOLLOW_A = '1'.repeat(64);
    const FOLLOW_B = '2'.repeat(64);
    const graph = demuxPrimalSocialGraph(
      [
        {
          id: 'c3'.padEnd(64, '0'),
          pubkey: PUB,
          kind: 3,
          content: '',
          tags: [['p', FOLLOW_A], ['p', FOLLOW_B]],
          created_at: 1_700_000_500,
        },
        {
          id: 'c0'.padEnd(64, '0'),
          pubkey: FOLLOW_A,
          kind: 0,
          content: JSON.stringify({ name: 'bob', picture: 'http://x/b.png' }),
        },
      ],
      PUB
    );
    expect(graph.pubkey).toBe(PUB);
    expect(graph.follows.sort()).toEqual([FOLLOW_A, FOLLOW_B].sort());
    expect(graph.contactsUpdatedAt).toBe(1_700_000_500);
    expect(graph.profiles[FOLLOW_A]).toEqual({ name: 'bob', picture: 'http://x/b.png' });
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

  /** Refuses the connection, as a host that is down does — close, never open. */
  class DeadWebSocket {
    onopen: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onclose: ((ev: unknown) => void) | null = null;
    static urls: string[] = [];
    constructor(public url: string) {
      DeadWebSocket.urls.push(url);
      queueMicrotask(() => this.onerror?.({}));
    }
    send() {}
    close() {}
  }

  /** Dead for the first host in the list, alive for every one after it. */
  function failFirstHost(deadUrl: string) {
    const tried: string[] = [];
    class Switching {
      onopen: ((ev: unknown) => void) | null = null;
      onmessage: ((ev: { data: unknown }) => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      onclose: ((ev: unknown) => void) | null = null;
      private live: FakeWebSocket | null = null;
      constructor(public url: string) {
        tried.push(url);
        if (url === deadUrl) {
          queueMicrotask(() => this.onerror?.({}));
          return;
        }
        this.live = new FakeWebSocket(url);
        this.live.onopen = (ev) => this.onopen?.(ev);
        this.live.onmessage = (ev) => this.onmessage?.(ev);
        queueMicrotask(() => this.live?.onopen?.({}));
      }
      send(data: string) {
        this.live!.onmessage = (ev) => this.onmessage?.(ev);
        this.live!.send(data);
      }
      close() {}
    }
    return { Switching, tried };
  }

  test('falls over to the next host when the first refuses, and reports which served', async () => {
    const { Switching, tried } = failFirstHost('wss://dead.test');
    const connection = createPrimalWebSocketConnection({
      url: ['wss://dead.test', 'wss://alive.test'],
      WebSocketImpl: Switching as unknown as new (url: string) => never,
    });

    const result = await connection.request({ verb: 'mega_feed_directive', params: { limit: 30 } });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(BATCH.length);
    // In order, and it stopped as soon as one answered.
    expect(tried).toEqual(['wss://dead.test', 'wss://alive.test']);
  });

  test('errors only after every host has been tried, so the facade falls to relays', async () => {
    DeadWebSocket.urls = [];
    const connection = createPrimalWebSocketConnection({
      url: ['wss://a.test', 'wss://b.test', 'wss://c.test'],
      WebSocketImpl: DeadWebSocket as unknown as new (url: string) => never,
    });

    const result = await connection.request({ verb: 'mega_feed_directive', params: { limit: 30 } });

    expect(result.isErr()).toBe(true);
    expect(DeadWebSocket.urls).toEqual(['wss://a.test', 'wss://b.test', 'wss://c.test']);
  });

  test('a single url string still works, and is not treated as a list of characters', async () => {
    const connection = createPrimalWebSocketConnection({
      url: 'wss://cache.test',
      WebSocketImpl: FakeWebSocket as unknown as new (url: string) => never,
    });
    const result = await connection.request({ verb: 'mega_feed_directive', params: { limit: 30 } });
    expect(result.isOk()).toBe(true);
  });

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
