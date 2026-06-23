import { describe, test, expect } from 'vitest';
import { ok, type Result } from 'neverthrow';
import { createNaggClient } from '../src/transport';
import {
  createNaggTier,
  createNostrDataLayer,
  pendingFeedTier,
  profileSearchHitsFromKind0,
} from '../src/facade';
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
  test('nagg serves ranked hits from /nostr/search', async () => {
    let lastUrl = '';
    const client = createNaggClient({
      appView: { baseUrl: 'https://nagg.test' },
      fetchImpl: (async (url: string) => {
        lastUrl = String(url);
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            query: 'ali',
            limit: 10,
            sort: 'globalPagerank',
            fromCache: false,
            results: [
              { pubkey: A, npub: 'npub1a', rank: 1, score: 0.9, name: 'alice', displayName: 'Alice' },
            ],
          }),
        } as unknown as Response;
      }) as unknown as typeof fetch,
    });
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });

    const result = await layer.searchProfiles({ query: 'ali', limit: 10 });
    expect(result.isOk()).toBe(true);
    const out = result._unsafeUnwrap();
    expect(lastUrl).toContain('/nostr/search');
    expect(out.tier).toBe('nagg');
    expect(out.hits[0]?.pubkey).toBe(A);
    expect(out.hits[0]?.metadata.displayName).toBe('Alice');
    expect(out.hits[0]?.rank).toBe(1);
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

  test('relay NIP-50 floor serves unranked kind-0 hits when nagg is down', async () => {
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
      tiers: [pendingFeedTier('nagg'), createRelayTier({ connection: relay })],
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
