import { describe, test, expect } from 'vitest';
import { ok, type Result } from 'neverthrow';
import { createNaggClient } from '../src/transport';
import { createNaggTier, createNostrDataLayer } from '../src/facade';
import {
  createRelayTier,
  type RelayConnection,
  type RawRelayEvent,
  type NostrFilter,
} from '../src/facade/relay';
import type { NaggError } from '../src/errors';

const ME = 'a'.repeat(64);
const SIG = 'd'.repeat(128);

function wrap(id: string, created_at: number): RawRelayEvent {
  return { id, pubkey: 'b'.repeat(64), kind: 1059, content: 'opaque-ciphertext', tags: [['p', ME]], created_at };
}

describe('getDmEnvelopes — nagg index', () => {
  test('returns opaque envelopes (no decryption) with an arrival-time cursor', async () => {
    let lastUrl = '';
    const client = createNaggClient({
      endpoint: 'https://nagg.test/graphql',
      appView: { baseUrl: 'https://nagg.test' },
      transport: 'appview',
      fetchImpl: (async (url: string) => {
        lastUrl = String(url);
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            dmEnvelopes: {
              nodes: [
                { id: '1'.repeat(64), pubkey: 'b'.repeat(64), kind: 1059, createdAt: 222, content: 'ct1', tags: [['p', ME]], sig: SIG },
                { id: '2'.repeat(64), pubkey: 'c'.repeat(64), kind: 4, createdAt: 111, content: 'ct2', tags: [['p', ME]], sig: SIG },
              ],
              pageInfo: { hasNextPage: false },
            },
          }),
        } as unknown as Response;
      }) as unknown as typeof fetch,
    });
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });

    const result = await layer.getDmEnvelopes({ viewerPubkey: ME });
    expect(result.isOk()).toBe(true);
    const out = result._unsafeUnwrap();
    expect(lastUrl).toContain('/nostr/dm/envelopes');
    expect(out.tier).toBe('nagg');
    expect(out.envelopes.map((e) => e.kind)).toEqual([1059, 4]); // both wrap + legacy, opaque
    expect(out.envelopes[0].content).toBe('ct1'); // ciphertext untouched
    expect(out.cursor).toEqual({ createdAt: 111, id: '2'.repeat(64) }); // tail = next page
  });
});

describe('getDmEnvelopes — relay floor', () => {
  test('fetches gift wraps by #p with NO since/limit (randomized created_at)', async () => {
    let captured: NostrFilter[] | undefined;
    const connection: RelayConnection = {
      request: (filters): Promise<Result<RawRelayEvent[], NaggError>> => {
        captured = filters;
        return Promise.resolve(ok([wrap('1'.repeat(64), 222), wrap('2'.repeat(64), 111)]));
      },
    };
    const layer = createNostrDataLayer({ tiers: [createRelayTier({ connection })] });

    const result = await layer.getDmEnvelopes({ viewerPubkey: ME, limit: 50 });
    expect(result.isOk()).toBe(true);
    const out = result._unsafeUnwrap();
    expect(out.tier).toBe('relay');
    expect(out.envelopes).toHaveLength(2);
    expect(out.cursor).toBeNull(); // relay can't paginate gift wraps by arrival
    // the load-bearing caution: no since/limit on the wrap filter
    const f = captured?.[0] ?? {};
    expect(f.kinds).toEqual([4, 1059]);
    expect(f['#p']).toEqual([ME]);
    expect('limit' in f).toBe(false);
    expect('since' in f).toBe(false);
    expect('until' in f).toBe(false);
  });
});
