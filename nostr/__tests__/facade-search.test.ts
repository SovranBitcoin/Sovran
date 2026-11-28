import { describe, test, expect, vi } from 'vitest';
import { ok, type Result } from 'neverthrow';
import { answered } from '../src/tiers';
import {
  createNostrDataLayer,
  mergeSearchHit,
  profileSearchHitsFromKind0,
} from '../src/facade';
import { emptyTier } from './emptyTier';
import { createRelayTier, type RelayConnection, type RawRelayEvent } from '../src/facade/relay';
import { createPrimalTier, type PrimalConnection, type RawPrimalEvent } from '../src/facade/primal';
import type { NaggError } from '../src/errors';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

describe('profileSearchHitsFromKind0 — relay floor parse', () => {
  test('keeps the latest kind-0 per author; drops junk + non-kind-0', () => {
    const hits = profileSearchHitsFromKind0([
      { pubkey: A, kind: 0, content: JSON.stringify({ name: 'old' }), created_at: 100 },
      { pubkey: A, kind: 0, content: JSON.stringify({ name: 'new' }), created_at: 200 },
      { pubkey: B, kind: 1, content: 'not a profile', created_at: 50 },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.pubkey).toBe(A);
    expect(hits[0]?.metadata.name).toBe('new');
    expect(hits[0]?.rank).toBeUndefined(); // floor is unranked
  });
});

describe('searchProfiles through the facade', () => {
  test('ranked hits are written through to the profile-stats owner', async () => {
    const layer = createNostrDataLayer({
      tiers: [
        {
          tier: 'primal',
          searchProfiles: async () =>
            answered({
              hits: [{ pubkey: A, metadata: { name: 'alice', displayName: 'Alice' }, rank: 1, score: 0.9 }],
            }),
        },
      ],
    });

    const out = (await layer.searchProfiles({ query: 'ali', limit: 10 }))._unsafeUnwrap();
    expect(out.hits[0]?.rank).toBe(1);
    // Written through to the single owner: the profile page, a mint row or a
    // provider row for Alice now shows the score the search did.
    expect(layer.cache.getProfileStats(A)).toMatchObject({ pubkey: A, rank: 1, score: 0.9 });
    expect(layer.cache.getProfileStats(A)?.followersCount).toBeUndefined();
    expect(layer.cache.getProfile(A)?.displayName).toBe('Alice');
  });

  test('Primal serves user_search before the relay floor (cache-only mode)', async () => {
    let verb: string | undefined;
    let params: Record<string, unknown> | undefined;
    const primal: PrimalConnection = {
      request: (req): Promise<Result<RawPrimalEvent[], NaggError>> => {
        verb = req.verb;
        params = req.params;
        return Promise.resolve(
          ok([{ id: '3'.repeat(64), pubkey: A, kind: 0, content: JSON.stringify({ name: 'aria' }), created_at: 100 }]),
        );
      },
    };
    const layer = createNostrDataLayer({ tiers: [createPrimalTier({ connection: primal })] });

    const result = await layer.searchProfiles({ query: 'ari', limit: 5 });
    expect(verb).toBe('user_search');
    expect(params).toMatchObject({ query: 'ari', limit: 5 });
    const out = result._unsafeUnwrap();
    expect(out.tier).toBe('primal');
    expect(out.hits[0]?.metadata.name).toBe('aria');
  });

  test('relay NIP-50 floor serves unranked kind-0 hits when Primal cannot', async () => {
    let captured: unknown;
    const relay: RelayConnection = {
      request: (filters): Promise<Result<RawRelayEvent[], NaggError>> => {
        captured = filters;
        return Promise.resolve(
          ok([{ id: '1'.repeat(64), pubkey: B, kind: 0, content: JSON.stringify({ name: 'bob' }), created_at: 100 }]),
        );
      },
    };
    const layer = createNostrDataLayer({
      tiers: [emptyTier('primal'), createRelayTier({ connection: relay })],
    });

    const result = await layer.searchProfiles({ query: 'bob' });
    expect(result.isOk()).toBe(true);
    const out = result._unsafeUnwrap();
    expect(out.tier).toBe('relay');
    expect(out.hits[0]?.metadata.name).toBe('bob');
    // NIP-50 search rides on a normal kind-0 filter.
    expect((captured as { search?: string; kinds?: number[] }[])[0]).toMatchObject({
      search: 'bob',
      kinds: [0],
    });
  });
});

describe('mergeSearchHit — an upgrade keeps what the new tier could not measure', () => {
  test('null figures never erase numbers; numbers and metadata upgrade', () => {
    const base = {
      pubkey: A,
      metadata: { name: 'alice' },
      rank: 1,
      score: 0.5,
      followers: 120,
      follows: 9,
    };
    const dvm = {
      pubkey: A,
      metadata: { displayName: 'Alice' },
      rank: 2,
      score: 0.9,
      followers: null,
      follows: null,
    };
    expect(mergeSearchHit(base, dvm)).toEqual({
      pubkey: A,
      metadata: { name: 'alice', displayName: 'Alice' },
      rank: 2,
      score: 0.9,
      followers: 120,
      follows: 9,
    });
  });

  test('a hit with no figures at all leaves the base figures alone', () => {
    const base = { pubkey: B, metadata: {}, score: 0.3, followers: 4 };
    expect(mergeSearchHit(base, { pubkey: B, metadata: {} })).toMatchObject({ score: 0.3, followers: 4 });
  });
});

describe('search results are not fetched again (audit D11)', () => {
  test('ten hits that came with their kind-0 leave nothing for the result rows to fetch', async () => {
    vi.useFakeTimers();
    try {
      const pubkeys = Array.from({ length: 10 }, (_, index) => index.toString(16).padStart(64, '0'));
      const events = pubkeys.map((pubkey, index) => ({
        id: `${pubkey.slice(2)}aa`,
        pubkey,
        kind: 0,
        content: JSON.stringify({ name: `hit-${index}`, lud16: `hit${index}@example.com` }),
        created_at: 1_700_000_000 + index,
      }));
      const profileRequests: unknown[] = [];
      const layer = createNostrDataLayer({
        tiers: [
          createPrimalTier({
            connection: {
              request: (request) => {
                if (request.verb === 'user_infos') profileRequests.push(request.params);
                return Promise.resolve(ok(request.verb === 'user_search' ? events : []));
              },
            },
          }),
        ],
      });
      const found = (await layer.searchProfiles({ query: 'hit', limit: 10 }))._unsafeUnwrap();
      expect(found.hits).toHaveLength(10);
      // Every hit is a fetched profile at its event's own time.
      for (const [index, pubkey] of pubkeys.entries()) {
        expect(layer.cache.getProfile(pubkey)).toMatchObject({
          name: `hit-${index}`,
          lud16: `hit${index}@example.com`,
          seenAt: 1_700_000_000 + index,
        });
      }
      // What each result row does on mount.
      expect(layer.ensureProfiles(pubkeys)).toEqual([]);
      await vi.advanceTimersByTimeAsync(100);
      expect(profileRequests).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
