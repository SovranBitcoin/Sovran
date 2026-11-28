import { describe, test, expect } from 'vitest';
import { ok, type Result } from 'neverthrow';
import { createNostrDataLayer, socialGraphFromEvents, type SocialGraph } from '../src/facade';
import { createRelayTier, type RelayConnection, type RawRelayEvent } from '../src/facade/relay';
import { createPrimalTier } from '../src/facade/primal';
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

  test('relay floor serves follows/relays/mutes', async () => {
    const layer = createNostrDataLayer({
      tiers: [createRelayTier({ connection: fakeRelay([CONTACTS, RELAYS, MUTES]) })],
    });

    const result = await layer.getSocialGraph({ pubkey: ME });
    expect(result.isOk()).toBe(true);
    const graph = result._unsafeUnwrap();
    expect(graph.tier).toBe('relay');
    expect(graph.follows).toEqual([F1, F2]);
    expect(graph.profiles).toEqual({}); // floor fetches profiles separately
  });

  test('the first tier to answer keeps its rank when a worse tier holds a list of the same age', async () => {
    const graph = (follows: string[]): SocialGraph => ({
      pubkey: ME,
      follows,
      profiles: {},
      relayList: [],
      mutes: [],
      contactsUpdatedAt: 200,
    });
    let answerPrimal!: () => void;
    const primalAnswered = new Promise<void>((resolve) => {
      answerPrimal = resolve;
    });
    const layer = createNostrDataLayer({
      tiers: [
        { tier: 'nagg', getSocialGraph: async () => ({ kind: 'answered', value: graph([F1]) }) },
        {
          tier: 'primal',
          getSocialGraph: async () => {
            await primalAnswered;
            return { kind: 'answered', value: graph([F2]) };
          },
        },
      ],
    });
    const updates: string[][] = [];
    const first = (
      await layer.getSocialGraph({ pubkey: ME, onUpdate: (g) => updates.push(g.follows) })
    )._unsafeUnwrap();
    expect(first.follows).toEqual([F1]);

    answerPrimal();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(updates.length).toBeGreaterThan(0);
    for (const follows of updates) expect(follows).toEqual([F1]);
  });

});

describe('getSocialGraph without profiles (D12)', () => {
  test('asks Primal for the contact list alone and caches nobody', async () => {
    const me = 'a'.repeat(64);
    const followed = 'b'.repeat(64);
    const params: unknown[] = [];
    const layer = createNostrDataLayer({
      tiers: [
        createPrimalTier({
          connection: {
            request: (request) => {
              params.push(request.params);
              return Promise.resolve(
                ok([
                  { id: '1'.repeat(64), pubkey: me, kind: 3, content: '', tags: [['p', followed]], created_at: 100 },
                  // A cache that bundles profiles anyway must still not reach the entity cache.
                  { id: '2'.repeat(64), pubkey: followed, kind: 0, content: '{"name":"bob"}', created_at: 100 },
                ]),
              );
            },
          },
        }),
      ],
    });
    const graph = (await layer.getSocialGraph({ pubkey: me, withProfiles: false }))._unsafeUnwrap();
    expect(graph.follows).toEqual([followed]);
    expect(params).toEqual([{ pubkey: me, extended_response: false }]);
    expect(layer.cache.getProfile(followed)).toBeUndefined();

    // The default still bundles and caches, as the own-graph seed needs.
    await layer.getSocialGraph({ pubkey: me });
    expect(params[1]).toEqual({ pubkey: me, extended_response: true });
    expect(layer.cache.getProfile(followed)?.name).toBe('bob');
  });
});
