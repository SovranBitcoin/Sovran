import { describe, test, expect, vi, afterEach } from 'vitest';
import { ok, type Result } from 'neverthrow';
import { createNostrDataLayer, noteStatsFromRelayEvents, noteStatsBatches } from '../src/facade';
import { createRelayTier, type RelayConnection, type RawRelayEvent } from '../src/facade/relay';
import { createNaggTier } from '../src/facade/nagg-tier';
import { createNaggClient } from '../src/transport';
import type { NaggError } from '../src/errors';

const N1 = '1'.repeat(64);
const N2 = '2'.repeat(64);
const A = 'a'.repeat(64);

function ev(id: string, kind: number, target: string, content = ''): RawRelayEvent {
  return { id, pubkey: A, kind, content, tags: [['e', target]], created_at: 100 };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('noteStatsFromRelayEvents', () => {
  test('counts likes (not downvotes), reposts, replies and zaps per referenced id; unengaged ids read zero', () => {
    const stats = noteStatsFromRelayEvents(
      [N1, N2],
      [
        { id: 'x1', pubkey: A, kind: 7, content: '+', tags: [['e', N1]], created_at: 1 },
        { id: 'x2', pubkey: A, kind: 7, content: '-', tags: [['e', N1]], created_at: 1 },
        { id: 'x3', pubkey: A, kind: 6, content: '', tags: [['e', N1]], created_at: 1 },
        { id: 'x4', pubkey: A, kind: 1, content: 'reply', tags: [['e', N1, '', 'reply']], created_at: 1 },
        { id: 'x5', pubkey: A, kind: 9735, content: '', tags: [['e', N1]], created_at: 1 },
        { id: 'x6', pubkey: A, kind: 7, content: '🔥', tags: [['e', 'f'.repeat(64)]], created_at: 1 },
      ],
    );
    expect(stats[N1]).toEqual({ likes: 1, reposts: 1, replies: 1, zaps: 1, satsZapped: 0 });
    expect(stats[N2]).toEqual({ likes: 0, reposts: 0, replies: 0, zaps: 0, satsZapped: 0 });
  });

  test('batches ids at the facade cap, deduped', () => {
    const ids = Array.from({ length: 120 }, (_, i) => `id${i}`);
    const batches = noteStatsBatches([...ids, 'id0'], 50);
    expect(batches.map((b) => b.length)).toEqual([50, 50, 20]);
  });
});

describe('getNoteStats through the facade', () => {
  test('relay floor answers counts; ids are pending until settled and land in the entity cache', async () => {
    const relay: RelayConnection = {
      request: (): Promise<Result<RawRelayEvent[], NaggError>> =>
        Promise.resolve(ok([ev('r1', 7, N1, '+'), ev('r2', 7, N1, '+')])),
    };
    const layer = createNostrDataLayer({ tiers: [createRelayTier({ connection: relay })] });
    const result = await layer.getNoteStats({ ids: [N1, N2] });
    const out = result._unsafeUnwrap();
    expect(out.tier).toBe('relay');
    expect(out.stats[N1]?.likes).toBe(2);
    expect(out.stats[N2]?.likes).toBe(0);
    expect(layer.cache.getNoteStats(N1)?.likes).toBe(2);
    expect(layer.cache.pendingNoteStats.has(N1)).toBe(false);
  });

  test('nagg aggregates win over a slower relay lower bound; both are asked at once', async () => {
    vi.useFakeTimers();
    let resolveRelay!: (value: Result<RawRelayEvent[], NaggError>) => void;
    const relayRequests: unknown[] = [];
    const relay: RelayConnection = {
      request: () => {
        relayRequests.push(1);
        return new Promise((resolve) => {
          resolveRelay = resolve;
        });
      },
    };
    const client = createNaggClient({
      appView: { baseUrl: 'https://nagg.test' },
      fetchImpl: (async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            order: [],
            events: [],
            aggregates: { [N1]: { k7_e: { actors: 40 } } },
            profiles: {},
            providers: {},
            pubkeys: [],
          }),
        }) as unknown as Response) as unknown as typeof fetch,
    });
    const layer = createNostrDataLayer({
      tiers: [createNaggTier({ client }), createRelayTier({ connection: relay })],
    });
    const pending = layer.getNoteStats({ ids: [N1] });
    await vi.advanceTimersByTimeAsync(0);
    expect(relayRequests).toHaveLength(1); // fan-out, not a waterfall
    const first = (await pending)._unsafeUnwrap();
    expect(first.tier).toBe('nagg');
    expect(first.provenance?.complete).toBe(false);
    expect(layer.cache.pendingNoteStats.has(N1)).toBe(true);
    resolveRelay(ok([ev('r1', 7, N1, '+')]));
    await vi.advanceTimersByTimeAsync(0);
    // nagg's count stays (higher rank); the relay's single like cannot overwrite it.
    expect(layer.cache.getNoteStats(N1)?.likes).toBe(40);
    expect(layer.cache.pendingNoteStats.has(N1)).toBe(false);
  });

  test('an empty id list is a cache answer with no network', async () => {
    const request = vi.fn();
    const layer = createNostrDataLayer({ tiers: [createRelayTier({ connection: { request } })] });
    const out = (await layer.getNoteStats({ ids: [] }))._unsafeUnwrap();
    expect(out).toMatchObject({ tier: 'cache', stats: {} });
    expect(request).not.toHaveBeenCalled();
  });
});
