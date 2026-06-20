import { describe, test, expect } from 'vitest';
import { ok, type Result } from 'neverthrow';
import {
  demuxRelayFeed,
  createRelayTier,
  createRelayPoolConnection,
  type RelayConnection,
  type RawRelayEvent,
} from '../src/facade/relay';
import { createNostrDataLayer, pendingFeedTier } from '../src/facade';
import type { NaggError } from '../src/errors';

const ID_A = 'a'.repeat(64);
const ID_B = 'b'.repeat(64);
const ID_C = 'c'.repeat(64);
const PUB = 'd'.repeat(64);

function note(id: string, created_at: number): RawRelayEvent {
  return { id, pubkey: PUB, kind: 1, content: `note ${id}`, tags: [], created_at };
}

describe('demuxRelayFeed — floor bundle', () => {
  test('notes + profiles, empty stats, synthesized recency manifest', () => {
    const bundle = demuxRelayFeed([
      note(ID_B, 1_700_000_100),
      note(ID_A, 1_700_000_200),
      { pubkey: PUB, kind: 0, content: JSON.stringify({ name: 'alice', picture: 'http://x/a.png' }) },
    ]);

    expect(bundle.manifest.orderBy).toBe('created_at');
    expect(bundle.manifest.elements).toEqual([ID_A, ID_B]); // newest first
    expect(bundle.stats).toEqual({}); // no engagement counts on the floor
    expect(bundle.actions).toBeUndefined();
    expect(bundle.profiles[PUB]).toEqual({ name: 'alice', picture: 'http://x/a.png' });
    expect(bundle.cursor).toEqual({ createdAt: 1_700_000_100, id: ID_B });
  });
});

describe('relay tier through the facade — three-tier fallback', () => {
  function fakeConnection(events: RawRelayEvent[]): RelayConnection {
    return {
      request(): Promise<Result<RawRelayEvent[], NaggError>> {
        return Promise.resolve(ok(events));
      },
    };
  }

  test('relay answers a degraded For-You when nagg and Primal cannot', async () => {
    const layer = createNostrDataLayer({
      feedTiers: [
        pendingFeedTier('nagg'),
        pendingFeedTier('primal'),
        createRelayTier({ connection: fakeConnection([note(ID_A, 1_700_000_200), note(ID_B, 1_700_000_100)]) }),
      ],
    });

    const result = await layer.getFeedPage({ spec: { kind: 'for-you' } });
    expect(result.isOk()).toBe(true);
    const page = result._unsafeUnwrap();
    expect(page.tier).toBe('relay');
    expect(page.items.map((i) => (i.type === 'note' ? i.event.id : ''))).toEqual([ID_A, ID_B]);
  });

  test('following-popular is unsupported on the floor (needs the follow list)', async () => {
    const tier = createRelayTier({ connection: fakeConnection([]) });
    const outcome = await tier.feedPage({ spec: { kind: 'following-popular', viewerPubkey: PUB } });
    expect(outcome.kind).toBe('unsupported');
  });
});

describe('relay pool connection — dedup + EOSE quorum', () => {
  // Per-relay scripted events; ID_B is delivered by BOTH relays to prove dedup.
  const SCRIPT: Record<string, RawRelayEvent[]> = {
    'wss://r1': [note(ID_A, 200), note(ID_B, 100)],
    'wss://r2': [note(ID_B, 100), note(ID_C, 50)],
  };

  class FakeRelaySocket {
    onopen: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onclose: ((ev: unknown) => void) | null = null;
    constructor(public url: string) {
      queueMicrotask(() => this.onopen?.({}));
    }
    send(data: string) {
      const [, subId] = JSON.parse(data) as [string, string];
      const events = SCRIPT[this.url] ?? [];
      queueMicrotask(() => {
        for (const ev of events) this.onmessage?.({ data: JSON.stringify(['EVENT', subId, ev]) });
        this.onmessage?.({ data: JSON.stringify(['EOSE', subId]) });
      });
    }
    close() {}
  }

  test('collects from both relays, deduped by id, once the EOSE quorum settles', async () => {
    const connection = createRelayPoolConnection({
      relays: ['wss://r1', 'wss://r2'],
      WebSocketImpl: FakeRelaySocket as unknown as new (url: string) => never,
      settleMs: 5,
    });

    const result = await connection.request([{ kinds: [1] }]);
    expect(result.isOk()).toBe(true);
    const ids = result._unsafeUnwrap().map((e) => e.id).sort();
    expect(ids).toEqual([ID_A, ID_B, ID_C].sort()); // ID_B not duplicated
  });
});
