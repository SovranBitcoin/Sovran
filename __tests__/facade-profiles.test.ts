import { describe, test, expect } from 'vitest';
import { ok, type Result } from 'neverthrow';
import {
  parseProfileMetadata,
  profilesFromKind0,
  createNostrDataLayer,
  pendingFeedTier,
} from '../src/facade';
import { createRelayTier, type RelayConnection, type RawRelayEvent } from '../src/facade/relay';
import { createPrimalTier, type PrimalConnection, type RawPrimalEvent } from '../src/facade/primal';
import type { NaggError } from '../src/errors';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

describe('parseProfileMetadata', () => {
  test('parses full metadata + display_name alias; null on junk', () => {
    const m = parseProfileMetadata(
      JSON.stringify({ name: 'al', display_name: 'Alice', picture: 'p', nip05: 'a@b', lud16: 'a@c' }),
    );
    expect(m).toMatchObject({ name: 'al', displayName: 'Alice', picture: 'p', nip05: 'a@b', lud16: 'a@c' });
    expect(parseProfileMetadata('{not json')).toBeNull();
    expect(parseProfileMetadata('{}')).toBeNull(); // nothing useful
  });
});

describe('profilesFromKind0', () => {
  test('keeps the latest kind-0 per author', () => {
    const profiles = profilesFromKind0([
      { pubkey: A, kind: 0, content: JSON.stringify({ name: 'old' }), created_at: 100 },
      { pubkey: A, kind: 0, content: JSON.stringify({ name: 'new' }), created_at: 200 },
      { pubkey: B, kind: 1, content: 'not a profile', created_at: 50 }, // non-kind-0 ignored
    ]);
    expect(profiles[A]?.name).toBe('new');
    expect(profiles[B]).toBeUndefined();
  });
});

describe('getProfiles through the facade', () => {
  test('relay floor serves kind-0 by authors', async () => {
    const events: RawRelayEvent[] = [
      { id: '1'.repeat(64), pubkey: A, kind: 0, content: JSON.stringify({ name: 'alice' }), created_at: 100 },
    ];
    let captured: unknown;
    const connection: RelayConnection = {
      request: (filters): Promise<Result<RawRelayEvent[], NaggError>> => {
        captured = filters;
        return Promise.resolve(ok(events));
      },
    };
    const layer = createNostrDataLayer({ tiers: [pendingFeedTier('nagg'), createRelayTier({ connection })] });
    const result = await layer.getProfiles({ pubkeys: [A] });
    expect(result.isOk()).toBe(true);
    const out = result._unsafeUnwrap();
    expect(out.tier).toBe('relay');
    expect(out.profiles[A]?.name).toBe('alice');
    expect((captured as { authors?: string[] }[])[0]?.authors).toEqual([A]);
  });

  test('Primal serves user_infos before the relay floor', async () => {
    const batch: RawPrimalEvent[] = [
      { id: '2'.repeat(64), pubkey: A, kind: 0, content: JSON.stringify({ display_name: 'Alice P' }), created_at: 100 },
    ];
    let verb: string | undefined;
    const primal: PrimalConnection = {
      request: (req): Promise<Result<RawPrimalEvent[], NaggError>> => {
        verb = req.verb;
        return Promise.resolve(ok(batch));
      },
    };
    const layer = createNostrDataLayer({ tiers: [createPrimalTier({ connection: primal })] });
    const result = await layer.getProfiles({ pubkeys: [A] });
    expect(verb).toBe('user_infos');
    expect(result._unsafeUnwrap().profiles[A]?.displayName).toBe('Alice P');
  });

  test('empty pubkeys short-circuits to an empty answer', async () => {
    const tier = createRelayTier({ connection: { request: () => Promise.resolve(ok([])) } });
    const outcome = await tier.getProfiles!({ pubkeys: [] });
    expect(outcome.kind).toBe('answered');
  });
});

describe('getProfiles is cache-first', () => {
  const kind0 = (pubkey: string, name: string, id: string): RawRelayEvent => ({
    id,
    pubkey,
    kind: 0,
    content: JSON.stringify({ name }),
    created_at: 100,
  });

  function countingRelayLayer() {
    const captured: { authors?: string[] }[][] = [];
    const connection: RelayConnection = {
      request: (filters): Promise<Result<RawRelayEvent[], NaggError>> => {
        captured.push(filters as { authors?: string[] }[]);
        const authors = (filters as { authors?: string[] }[])[0]?.authors ?? [];
        const events = authors.map((pk) =>
          kind0(pk, pk === A ? 'alice' : 'bob', (pk === A ? '1' : '2').repeat(64)),
        );
        return Promise.resolve(ok(events));
      },
    };
    return { layer: createNostrDataLayer({ tiers: [createRelayTier({ connection })] }), captured };
  }

  test('a repeat read serves from cache with no network call', async () => {
    const { layer, captured } = countingRelayLayer();
    const first = await layer.getProfiles({ pubkeys: [A] });
    expect(first._unsafeUnwrap().tier).toBe('relay');
    expect(captured).toHaveLength(1);

    const second = await layer.getProfiles({ pubkeys: [A] });
    const out = second._unsafeUnwrap();
    expect(out.tier).toBe('cache'); // served instantly
    expect(out.profiles[A]?.name).toBe('alice');
    expect(captured).toHaveLength(1); // no second fetch
  });

  test('fetches only the missing pubkeys and merges with the cached ones', async () => {
    const { layer, captured } = countingRelayLayer();
    await layer.getProfiles({ pubkeys: [A] }); // caches A

    const result = await layer.getProfiles({ pubkeys: [A, B] });
    const out = result._unsafeUnwrap();
    expect(out.profiles[A]?.name).toBe('alice'); // from cache
    expect(out.profiles[B]?.name).toBe('bob'); // freshly fetched
    // the second fetch asked the tier ONLY for the missing pubkey
    expect(captured[1][0].authors).toEqual([B]);
  });

  test('refresh bypasses the cache and refetches everything', async () => {
    const { layer, captured } = countingRelayLayer();
    await layer.getProfiles({ pubkeys: [A] });
    const refreshed = await layer.getProfiles({ pubkeys: [A], refresh: true });
    expect(refreshed._unsafeUnwrap().tier).toBe('relay');
    expect(captured).toHaveLength(2);
    expect(captured[1][0].authors).toEqual([A]);
  });
});
