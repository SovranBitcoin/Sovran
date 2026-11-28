import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ok, type Result } from 'neverthrow';
import { createBatcher } from '../src/facade/batcher';
import { createNostrDataLayer } from '../src/facade';
import { createRelayTier, type RelayConnection, type RawRelayEvent } from '../src/facade/relay';
import { createPrimalTier, type PrimalConnection, type RawPrimalEvent } from '../src/facade/primal';
import type { NaggError } from '../src/errors';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('createBatcher', () => {
  test('keys asked for within one window go out as one fetch, and each caller gets its own value', async () => {
    const fetch = vi.fn((keys: string[]) => (key: string) => Promise.resolve(`${key}/${keys.length}`));
    const batcher = createBatcher({ fetch });
    const loads = ['a', 'b', 'c'].map((key) => batcher.load(key));
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(16);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(['a', 'b', 'c']);
    expect(await Promise.all(loads)).toEqual(['a/3', 'b/3', 'c/3']);
  });

  test('a key already queued or in flight is not asked for twice', async () => {
    let release!: (value: string) => void;
    const fetch = vi.fn((_keys: string[]) => () => new Promise<string>((resolve) => (release = resolve)));
    const batcher = createBatcher({ fetch });
    const first = batcher.load('a');
    const second = batcher.load('a');
    expect(second).toBe(first);
    await vi.advanceTimersByTimeAsync(16);
    // Still in flight: a third caller joins the same request.
    expect(batcher.load('a')).toBe(first);
    expect(batcher.has('a')).toBe(true);
    release('done');
    expect(await first).toBe('done');
    await vi.advanceTimersByTimeAsync(0);
    expect(batcher.has('a')).toBe(false);
    void batcher.load('a');
    await vi.advanceTimersByTimeAsync(16);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([keys]) => keys)).toEqual([['a'], ['a']]);
  });

  test('keys asked for in a later window form a later batch', async () => {
    const fetch = vi.fn((keys: string[]) => () => Promise.resolve(keys.length));
    const batcher = createBatcher({ fetch });
    void batcher.load('a');
    await vi.advanceTimersByTimeAsync(16);
    void batcher.load('b');
    await vi.advanceTimersByTimeAsync(16);
    expect(fetch.mock.calls.map(([keys]) => keys)).toEqual([['a'], ['b']]);
  });

  test('a queue past maxKeys is split, and a full one goes out without waiting', async () => {
    const fetch = vi.fn((keys: string[]) => () => Promise.resolve(keys.length));
    const batcher = createBatcher({ fetch, maxKeys: 100 });
    for (let index = 0; index < 250; index += 1) void batcher.load(`k${index}`);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(16);
    expect(fetch.mock.calls.map(([keys]) => keys.length)).toEqual([100, 100, 50]);
  });
});

// ---------------------------------------------------------------------------
// D1: a cold list of N=50 rows, each asking for its own profile.
// ---------------------------------------------------------------------------

const PUBKEYS = Array.from({ length: 50 }, (_, index) => index.toString(16).padStart(64, '0'));

function kind0(pubkey: string, createdAt = 1_700_000_000): RawRelayEvent {
  return { id: `${pubkey.slice(2)}ee`, pubkey, kind: 0, content: JSON.stringify({ name: `n-${pubkey.slice(-2)}` }), created_at: createdAt };
}

function countingLayer(known: readonly string[] = PUBKEYS) {
  const primalRequests: string[][] = [];
  const relayRequests: string[][] = [];
  const primal: PrimalConnection = {
    request: (request): Promise<Result<RawPrimalEvent[], NaggError>> => {
      const asked = (request.params as { pubkeys: string[] }).pubkeys;
      primalRequests.push(asked);
      return Promise.resolve(ok(asked.filter((pk) => known.includes(pk)).map((pk) => kind0(pk))));
    },
  };
  const relay: RelayConnection = {
    request: (filters): Promise<Result<RawRelayEvent[], NaggError>> => {
      const asked = filters[0]!.authors ?? [];
      relayRequests.push(asked);
      return Promise.resolve(ok(asked.filter((pk) => known.includes(pk)).map((pk) => kind0(pk))));
    },
  };
  const layer = createNostrDataLayer({
    tiers: [createPrimalTier({ connection: primal }), createRelayTier({ connection: relay })],
  });
  return { layer, primalRequests, relayRequests };
}

describe('profile loads are batched per source', () => {
  test('50 rows each loading their own profile make one request per source', async () => {
    const { layer, primalRequests, relayRequests } = countingLayer();
    const loads = PUBKEYS.map((pubkey) => layer.loadProfiles([pubkey]));
    await vi.advanceTimersByTimeAsync(16);
    const results = await Promise.all(loads);
    expect(primalRequests).toHaveLength(1);
    expect(relayRequests).toHaveLength(1);
    expect(primalRequests[0]).toHaveLength(50);
    expect(relayRequests[0]).toHaveLength(50);
    results.forEach((result, index) =>
      expect(result).toEqual({ [PUBKEYS[index]!]: { name: `n-${PUBKEYS[index]!.slice(-2)}` } }),
    );
  });

  test('50 rows calling ensureProfiles make one request per source, and a second pass makes none', async () => {
    const { layer, primalRequests, relayRequests } = countingLayer();
    for (const pubkey of PUBKEYS) layer.ensureProfiles([pubkey]);
    for (const pubkey of PUBKEYS) layer.ensureProfiles([pubkey]);
    await vi.advanceTimersByTimeAsync(16);
    await vi.advanceTimersByTimeAsync(0);
    expect(primalRequests).toHaveLength(1);
    expect(relayRequests).toHaveLength(1);
    // Everything is cached and fresh now.
    expect(layer.ensureProfiles(PUBKEYS)).toEqual([]);
    await vi.advanceTimersByTimeAsync(16);
    expect(primalRequests).toHaveLength(1);
  });

  test('only the row whose profile arrived is notified, and an unchanged profile keeps its identity', async () => {
    const { layer } = countingLayer();
    const notified = new Map<string, number>();
    for (const pubkey of PUBKEYS) {
      layer.cache.profiles.subscribeKey(pubkey, () => notified.set(pubkey, (notified.get(pubkey) ?? 0) + 1));
    }
    layer.ensureProfiles(PUBKEYS.slice(0, 3));
    await vi.advanceTimersByTimeAsync(16);
    await vi.advanceTimersByTimeAsync(0);
    expect([...notified.keys()].sort()).toEqual(PUBKEYS.slice(0, 3).sort());
    // Primal and the relay returned the same event: one change per row, not two.
    expect([...notified.values()]).toEqual([1, 1, 1]);
    const before = layer.cache.profiles.peek(PUBKEYS[0]!);
    const reload = layer.loadProfiles([PUBKEYS[0]!]);
    await vi.advanceTimersByTimeAsync(16);
    await reload;
    expect(layer.cache.profiles.peek(PUBKEYS[0]!)).toBe(before);
  });

  test('a profile no source has is not asked for again until its miss expires', async () => {
    const { layer, primalRequests } = countingLayer([]);
    const absent = PUBKEYS[0]!;
    expect(layer.ensureProfiles([absent])).toEqual([absent]);
    await vi.advanceTimersByTimeAsync(16);
    await vi.advanceTimersByTimeAsync(0);
    expect(primalRequests).toHaveLength(1);
    expect(layer.cache.isProfileMissed(absent)).toBe(true);
    // Every remount in the next minute is free.
    for (let i = 0; i < 20; i += 1) expect(layer.ensureProfiles([absent])).toEqual([]);
    await vi.advanceTimersByTimeAsync(16);
    expect(primalRequests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(layer.ensureProfiles([absent])).toEqual([absent]);
    await vi.advanceTimersByTimeAsync(16);
    expect(primalRequests).toHaveLength(2);
  });

  test('a cached profile older than maxAge is revalidated; a fresh one is not', async () => {
    const { layer, primalRequests } = countingLayer();
    const [fresh, stale] = PUBKEYS;
    layer.cache.ingestProfileMetadata({ [fresh!]: { name: 'f' }, [stale!]: { name: 's' } }, 1, 'cache', {
      createdAt: { [fresh!]: 1_700_000_000, [stale!]: 1_700_000_000 },
      fetchedAt: { [fresh!]: Date.now() - 60_000, [stale!]: Date.now() - 25 * 60 * 60 * 1000 },
    });
    expect(layer.ensureProfiles([fresh!, stale!], { maxAgeMs: 24 * 60 * 60 * 1000 })).toEqual([stale]);
    await vi.advanceTimersByTimeAsync(16);
    expect(primalRequests).toEqual([[stale]]);
  });

  test('a stale profile no source returns this time is kept and not refetched in a loop', async () => {
    const { layer, primalRequests } = countingLayer([]);
    const stale = PUBKEYS[0]!;
    layer.cache.ingestProfileMetadata({ [stale]: { name: 's', lud16: 's@x.example' } }, 1, 'cache', {
      createdAt: { [stale]: 1_700_000_000 },
      fetchedAt: { [stale]: Date.now() - 25 * 60 * 60 * 1000 },
    });
    expect(layer.ensureProfiles([stale])).toEqual([stale]);
    await vi.advanceTimersByTimeAsync(16);
    await vi.advanceTimersByTimeAsync(0);
    expect(layer.cache.getProfile(stale)?.name).toBe('s');
    expect(layer.ensureProfiles([stale])).toEqual([]);
    expect(primalRequests).toHaveLength(1);
  });
});
