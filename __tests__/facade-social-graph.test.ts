import { describe, test, expect } from 'vitest';
import { ok, type Result } from 'neverthrow';
import { createNaggClient } from '../src/transport';
import { createNaggTier, createNostrDataLayer, socialGraphFromEvents } from '../src/facade';
import { createRelayTier, type RelayConnection, type RawRelayEvent } from '../src/facade/relay';
import type { NaggError } from '../src/errors';

const ME = 'a'.repeat(64);
const F1 = 'b'.repeat(64);
const F2 = 'e'.repeat(64);
const M1 = 'f'.repeat(64);

const CONTACTS = { id: '1'.repeat(64), pubkey: ME, kind: 3, content: '', tags: [['p', F1], ['p', F2]] as string[][], created_at: 200 };
const RELAYS = { id: '2'.repeat(64), pubkey: ME, kind: 10_002, content: '', tags: [['r', 'wss://a'], ['r', 'wss://b', 'write']] as string[][], created_at: 200 };
const MUTES = { id: '3'.repeat(64), pubkey: ME, kind: 10_000, content: '', tags: [['p', M1]] as string[][], created_at: 200 };

describe('socialGraphFromEvents — relay floor parse', () => {
  test('parses follows, relay list (NIP-65 markers), and mutes from the latest events', () => {
    const graph = socialGraphFromEvents(ME, [CONTACTS, RELAYS, MUTES].map((e) => ({ ...e })));
    expect(graph.follows).toEqual([F1, F2]);
    expect(graph.contactsUpdatedAt).toBe(200); // the kind-3's created_at, for the app's LWW gate
    expect(graph.mutes).toEqual([M1]);
    expect(graph.relayList).toEqual([
      { url: 'wss://a', read: true, write: true },
      { url: 'wss://b', read: false, write: true },
    ]);
  });

  test('a newer kind-3 replaces an older one (LWW)', () => {
    const older = { id: '9'.repeat(64), pubkey: ME, kind: 3, content: '', tags: [['p', F1]] as string[][], created_at: 100 };
    const graph = socialGraphFromEvents(ME, [older, CONTACTS]);
    expect(graph.follows).toEqual([F1, F2]); // the created_at:200 event wins
  });
});

describe('getSocialGraph through the facade', () => {
  function fakeRelay(events: RawRelayEvent[]): RelayConnection {
    return { request: (): Promise<Result<RawRelayEvent[], NaggError>> => Promise.resolve(ok(events)) };
  }

  test('nagg serves the bundled response (follows + profiles + relays + mutes)', async () => {
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
            pubkey: ME,
            follows: [F1, F2],
            profiles: { [F1]: { name: 'f1' } },
            relays: [{ url: 'wss://a' }],
            mutes: [M1],
          }),
        } as unknown as Response;
      }) as unknown as typeof fetch,
    });
    const layer = createNostrDataLayer({ tiers: [createNaggTier({ client })] });

    const result = await layer.getSocialGraph({ pubkey: ME });
    expect(result.isOk()).toBe(true);
    const graph = result._unsafeUnwrap();
    expect(lastUrl).toContain('/nostr/social-graph');
    expect(graph.tier).toBe('nagg');
    expect(graph.follows).toEqual([F1, F2]);
    expect(graph.profiles[F1]).toEqual({ name: 'f1' });
  });

  test('relay floor serves follows/relays/mutes when nagg is down', async () => {
    const client = createNaggClient({
      appView: { baseUrl: 'https://nagg.test' },
      fetchImpl: (async () =>
        ({ ok: false, status: 503, statusText: 'x', json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch,
    });
    const layer = createNostrDataLayer({
      tiers: [createNaggTier({ client }), createRelayTier({ connection: fakeRelay([CONTACTS, RELAYS, MUTES]) })],
    });

    const result = await layer.getSocialGraph({ pubkey: ME });
    expect(result.isOk()).toBe(true);
    const graph = result._unsafeUnwrap();
    expect(graph.tier).toBe('relay');
    expect(graph.follows).toEqual([F1, F2]);
    expect(graph.profiles).toEqual({}); // floor fetches profiles separately
  });
});
