/**
 * @jest-environment node
 *
 * What tapping Follow publishes: the tap records an intent in the real social
 * store and the follow worker (`followSync`) turns outstanding intents into one
 * follow list built on the newest list it can vouch for. Replaced: the relays
 * (a fake NDK subscription per write relay), the publish seam, the signer, the
 * active account, the indexers, the popup and storage.
 */
import type NDK from '@nostr-dev-kit/ndk-mobile';
import { err, ok } from 'neverthrow';

import {
  applyFollowIntents,
  planFollowPublish,
  requestFollowSync,
} from '@/shared/lib/nostr/followSync';
import {
  selectContactList,
  selectIsFollowingPubkey,
  useNostrSocialStore,
} from '@/shared/stores/profile/nostrSocialStore';

const OWN = 'a0'.repeat(32);
const OTHER_ACCOUNT = 'e4'.repeat(32);
const W = 'f5'.repeat(32);
const X = 'b1'.repeat(32);
const Y = 'c2'.repeat(32);
const Z = 'd3'.repeat(32);
const T = 1_700_000_000;

type Relay = { url: string };
type RelayEvent = {
  kind: number;
  pubkey: string;
  created_at: number;
  tags: string[][];
  content: string;
  id: string;
};

const mockRelays: Relay[] = [{ url: 'wss://one.example' }, { url: 'wss://two.example' }];
/** Each relay's stored kind 3s; a relay missing here never answers. */
const mockStored = new Map<string, RelayEvent[]>();
const mockFilters: unknown[] = [];
let mockReadGate: Promise<void> = Promise.resolve();
const mockProfile = {
  activeAccountIndex: 0,
  profiles: [
    { accountIndex: 0, pubkey: OWN },
    { accountIndex: 1, pubkey: OTHER_ACCOUNT },
  ],
};
const mockProfileListeners = new Set<(state: typeof mockProfile) => void>();
const mockPublish = jest.fn();
const mockPopup = jest.fn();
const mockDisk = new Map<string, string>();
let mockLayer: { getSocialGraph: jest.Mock } | null = null;
let mockEventSeq = 0;

jest.mock('@nostr-dev-kit/ndk-mobile', () => ({
  __esModule: true,
  default: class {},
  NDKSubscriptionCacheUsage: { ONLY_RELAY: 'ONLY_RELAY' },
  NDKRelaySet: {
    fromRelayUrls: (urls: string[]) => ({
      relays: new Set(mockRelays.filter((relay) => urls.includes(relay.url))),
    }),
  },
  NDKEvent: class {
    kind = 0;
    pubkey = '';
    created_at = 0;
    tags: string[][] = [];
    content = '';
    id = '';
    getEventHash() {
      return this.id;
    }
    verifySignature() {
      return true;
    }
    async sign(signer: { sign: () => Promise<void>; user: () => Promise<{ pubkey: string }> }) {
      await signer.sign();
      this.pubkey = (await signer.user()).pubkey;
      this.id = (++mockEventSeq).toString(16).padStart(64, '0');
    }
  },
}));
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: {
    getState: () => mockProfile,
    subscribe: (listener: (state: typeof mockProfile) => void) => {
      mockProfileListeners.add(listener);
      return () => mockProfileListeners.delete(listener);
    },
  },
}));
jest.mock('@/shared/lib/nostr/outbox/relayListStore', () => ({
  getOwnWriteRelays: () => mockRelays.map((relay) => relay.url),
}));
jest.mock('@/shared/lib/nostr/publish', () => ({
  publishEvent: (...args: unknown[]) => mockPublish(...args),
}));
jest.mock('@/shared/lib/popup', () => ({
  paramPopup: (...args: unknown[]) => mockPopup(...args),
}));
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => mockLayer,
}));
jest.mock('@/shared/lib/logger', () => {
  // Every export is a silent logger that is also callable (`redactError`, hooks).
  const silent: object = new Proxy(() => undefined, { get: () => silent });
  return new Proxy({}, { get: (_target, key) => (key === '__esModule' ? false : silent) });
});
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async (key: string) => mockDisk.get(key) ?? null,
    setItem: async (key: string, value: string) => void mockDisk.set(key, value),
    removeItem: async (key: string) => void mockDisk.delete(key),
  }),
}));

function contacts(created_at: number, tags: string[][], content = ''): RelayEvent {
  return { kind: 3, pubkey: OWN, created_at, tags, content, id: `${created_at}`.padStart(64, '0') };
}

function relayEvent(raw: RelayEvent) {
  const { NDKEvent } = jest.requireMock('@nostr-dev-kit/ndk-mobile');
  return Object.assign(new NDKEvent(), raw);
}

/** Every write relay answers with these events (none: they answer that they hold no list). */
function relaysHold(...events: RelayEvent[]) {
  for (const relay of mockRelays) mockStored.set(relay.url, events);
}

/** The publish seam's default: every answering write relay stores the list. */
async function acceptOnRelays({ event }: { event: RelayEvent }) {
  for (const [url, stored] of mockStored) mockStored.set(url, [...stored, { ...event }]);
  return ok({});
}

function setup() {
  const signer = {
    sign: jest.fn(async () => undefined),
    user: jest.fn(async () => ({ pubkey: OWN })),
  };
  const ndk = {
    signer,
    subscribe: (filter: unknown, _options: unknown, relaySet: { relays: Set<Relay> }) => {
      mockFilters.push(filter);
      const [relay] = [...relaySet.relays];
      const listeners: Record<string, (...args: unknown[]) => void> = {};
      const subscription = {
        eosesSeen: new Set<Relay>(),
        stop: jest.fn(),
        on: (type: string, listener: (...args: unknown[]) => void) => {
          listeners[type] = listener;
        },
        start: jest.fn(async () => {
          await mockReadGate;
          const stored = mockStored.get(relay.url);
          if (!stored) return;
          for (const event of stored) listeners.event(relayEvent(event));
          subscription.eosesSeen.add(relay);
          listeners.eose();
        }),
      };
      return subscription;
    },
  } as unknown as NDK;
  return { ndk, signer };
}

function deferred<V = void>() {
  let resolve!: (value: V) => void;
  const promise = new Promise<V>((r) => (resolve = r));
  return { promise, resolve };
}

function social() {
  return useNostrSocialStore.getState();
}

/** The profile button's tap. */
function tap(target: string) {
  social().setFollowIntent(target, !selectIsFollowingPubkey(target)(social()));
}

function publishedTags(call = 0): string[][] {
  return mockPublish.mock.calls[call][0].event.tags;
}

function switchAccount() {
  mockProfile.activeAccountIndex = 1;
  for (const listener of mockProfileListeners) listener(mockProfile);
}

beforeEach(async () => {
  jest.useRealTimers();
  mockStored.clear();
  mockFilters.length = 0;
  mockReadGate = Promise.resolve();
  mockProfile.activeAccountIndex = 0;
  mockPublish.mockReset();
  mockPublish.mockImplementation(acceptOnRelays);
  mockPopup.mockReset();
  mockLayer = null;
  mockDisk.clear();
  useNostrSocialStore.setState(useNostrSocialStore.getInitialState(), true);
  await useNostrSocialStore.persist.rehydrate();
});

afterEach(() => {
  expect(mockProfileListeners.size).toBe(0);
});

describe('following someone', () => {
  it('publishes the read list exactly, hints, petnames, order and other tags kept, plus the new follow', async () => {
    const tags = [
      ['p', X, 'wss://hint.example', 'xavier'],
      ['t', 'bitcoin'],
      ['p', Y],
      ['p', Y, 'wss://duplicate.example'],
    ];
    social().setContactsFromRelay({ tags, content: '{"relays":1}', createdAtSec: T });
    relaysHold(contacts(T, tags, '{"relays":1}'));
    const { ndk } = setup();

    tap(Z);
    expect(selectIsFollowingPubkey(Z)(social())).toBe(true);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish.mock.calls[0][0].event).toMatchObject({
      kind: 3,
      tags: [...tags, ['p', Z]],
      content: '{"relays":1}',
    });
    expect(mockPublish.mock.calls[0][0].event.created_at).toBeGreaterThan(T);
    expect(social().followingPubkeys).toEqual({ [X]: true, [Y]: true, [Z]: true });
    expect(social().optimisticFollowsByPubkey).toEqual({});
    expect(selectContactList(social())).toEqual({
      status: 'known',
      updatedAt: mockPublish.mock.calls[0][0].event.created_at,
    });
  });

  it('reads the newest list with no time window from every write relay', async () => {
    relaysHold(contacts(T, [['p', X]]));
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockFilters).toEqual([
      { kinds: [3], authors: [OWN] },
      { kinds: [3], authors: [OWN] },
    ]);
    expect(publishedTags()).toEqual([
      ['p', X],
      ['p', Z],
    ]);
  });

  it('builds on a newer list another client published, read just now', async () => {
    social().setContactsFromRelay({ tags: [['p', X]], content: '', createdAtSec: T });
    mockStored.set(mockRelays[0].url, [contacts(T, [['p', X]])]);
    mockStored.set(mockRelays[1].url, [
      contacts(T + 10, [
        ['p', X],
        ['p', W],
      ]),
    ]);
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(publishedTags()).toEqual([
      ['p', X],
      ['p', W],
      ['p', Z],
    ]);
  });

  it('unfollows by removing only that entry', async () => {
    const tags = [
      ['p', X, 'wss://hint.example'],
      ['t', 'bitcoin'],
      ['p', Y, '', 'yolanda'],
    ];
    relaysHold(contacts(T, tags));
    social().setContactsFromRelay({ tags, content: '', createdAtSec: T });
    const { ndk } = setup();

    tap(X);
    expect(selectIsFollowingPubkey(X)(social())).toBe(false);
    await requestFollowSync(ndk, OWN);

    expect(publishedTags()).toEqual([
      ['t', 'bitcoin'],
      ['p', Y, '', 'yolanda'],
    ]);
  });

  it('publishes nothing and keeps the follow when only the nagg or Primal seed is known', async () => {
    social().seedFollowsFromFacade({ follows: [X, Y], createdAtSec: T });
    relaysHold();
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]).toMatchObject({ value: true, pending: true });
    expect(selectIsFollowingPubkey(Z)(social())).toBe(true);
    expect(social().followingPubkeys).toEqual({ [X]: true, [Y]: true });
  });

  it('publishes the full list plus the change once that list arrives', async () => {
    social().seedFollowsFromFacade({ follows: [X, Y], createdAtSec: T });
    relaysHold();
    const { ndk } = setup();
    tap(Z);
    await requestFollowSync(ndk, OWN);
    expect(mockPublish).not.toHaveBeenCalled();

    // The own-events subscription delivers the list; the hook asks again.
    relaysHold(
      contacts(T, [
        ['p', X, 'wss://hint.example'],
        ['p', Y],
      ])
    );
    social().setContactsFromRelay({
      tags: [
        ['p', X, 'wss://hint.example'],
        ['p', Y],
      ],
      content: '',
      createdAtSec: T,
    });
    await requestFollowSync(ndk, OWN);

    expect(publishedTags()).toEqual([
      ['p', X, 'wss://hint.example'],
      ['p', Y],
      ['p', Z],
    ]);
    expect(social().optimisticFollowsByPubkey).toEqual({});
  });

  it('waits rather than build on a list older than the seed', async () => {
    social().seedFollowsFromFacade({ follows: [X, Y], createdAtSec: T + 10 });
    relaysHold(contacts(T, [['p', X]]));
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);
  });

  it('does not bring back someone a newer list no longer holds', async () => {
    // A stale seed still lists Y, whom the person unfollowed elsewhere since.
    social().seedFollowsFromFacade({ follows: [X, Y], createdAtSec: T });
    relaysHold(contacts(T + 10, [['p', X]]));
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(publishedTags()).toEqual([
      ['p', X],
      ['p', Z],
    ]);
  });

  it('publishes one list holding both of two follows tapped quickly', async () => {
    relaysHold(contacts(T, [['p', X]]));
    const gate = deferred();
    mockReadGate = gate.promise;
    const { ndk } = setup();

    tap(Y);
    const first = requestFollowSync(ndk, OWN);
    tap(Z);
    const second = requestFollowSync(ndk, OWN);
    gate.resolve();
    await Promise.all([first, second]);

    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(publishedTags()).toEqual([
      ['p', X],
      ['p', Y],
      ['p', Z],
    ]);
    expect(social().optimisticFollowsByPubkey).toEqual({});
  });

  it('never has two lists in flight; a tap during a publish follows it, built on it', async () => {
    relaysHold(contacts(T, [['p', X]]));
    const publish = deferred();
    mockPublish.mockImplementationOnce(async (args: { event: RelayEvent }) => {
      await publish.promise;
      return acceptOnRelays(args);
    });
    const { ndk } = setup();

    tap(Y);
    const run = requestFollowSync(ndk, OWN);
    for (let i = 0; i < 20 && mockPublish.mock.calls.length === 0; i++) await Promise.resolve();
    expect(mockPublish).toHaveBeenCalledTimes(1);
    tap(Z);
    void requestFollowSync(ndk, OWN);
    await Promise.resolve();
    expect(mockPublish).toHaveBeenCalledTimes(1);
    publish.resolve();
    await run;

    expect(mockPublish).toHaveBeenCalledTimes(2);
    expect(publishedTags(1)).toEqual([
      ['p', X],
      ['p', Y],
      ['p', Z],
    ]);
    expect(mockPublish.mock.calls[1][0].event.created_at).toBeGreaterThan(
      mockPublish.mock.calls[0][0].event.created_at
    );
  });

  it('keeps the follow, shown as done, when no relay accepts the list', async () => {
    relaysHold(contacts(T, [['p', X]]));
    mockPublish.mockResolvedValue(err({ type: 'all-failed', relayResults: [] }));
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(social().optimisticFollowsByPubkey[Z]).toMatchObject({ value: true, pending: true });
    expect(selectIsFollowingPubkey(Z)(social())).toBe(true);
    expect(social().followingPubkeys).toEqual({ [X]: true });
    expect(mockPopup).not.toHaveBeenCalled();
  });

  it('tries again for a tap made while a publish was failing', async () => {
    relaysHold(contacts(T, [['p', X]]));
    mockPublish.mockImplementationOnce(async () => {
      tap(Z);
      void requestFollowSync(ndk, OWN);
      return err({ type: 'all-failed', relayResults: [] });
    });
    const { ndk } = setup();

    tap(Y);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).toHaveBeenCalledTimes(2);
    expect(publishedTags(1)).toEqual([
      ['p', X],
      ['p', Y],
      ['p', Z],
    ]);
    expect(social().optimisticFollowsByPubkey).toEqual({});
  });

  it('keeps the follow when a write relay does not answer and no list is saved', async () => {
    jest.useFakeTimers();
    mockStored.set(mockRelays[0].url, []);
    const { ndk } = setup();

    tap(Z);
    const run = requestFollowSync(ndk, OWN);
    await jest.advanceTimersByTimeAsync(12_001);
    await run;

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);
  });

  it('waits rather than build on the saved list when a write relay does not answer', async () => {
    jest.useFakeTimers();
    social().setContactsFromRelay({ tags: [['p', X]], content: '', createdAtSec: T });
    mockStored.set(mockRelays[0].url, [contacts(T - 5, [])]);
    const { ndk } = setup();

    tap(Z);
    const run = requestFollowSync(ndk, OWN);
    await jest.advanceTimersByTimeAsync(12_001);
    await run;

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);
  });

  it('waits when an older list answers and the relay holding the newer one times out', async () => {
    jest.useFakeTimers();
    // Relay two holds [X, Y] and never answers; relay one has only the older [X].
    mockStored.set(mockRelays[0].url, [contacts(T, [['p', X]])]);
    const { ndk } = setup();

    tap(Z);
    const run = requestFollowSync(ndk, OWN);
    await jest.advanceTimersByTimeAsync(12_001);
    await run;

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);
    // The partial answer is not kept as the list a later follow builds on.
    expect(social().contactsUpdatedAt).toBe(0);
    expect(social().contactsTags).toEqual([]);
  });

  it('does not settle a tap against a read that did not finish', async () => {
    jest.useFakeTimers();
    mockStored.set(mockRelays[0].url, [
      contacts(T, [
        ['p', X],
        ['p', Z],
      ]),
    ]);
    const { ndk } = setup();

    social().setFollowIntent(Z, true);
    const run = requestFollowSync(ndk, OWN);
    await jest.advanceTimersByTimeAsync(12_001);
    await run;

    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);
  });

  it('waits when the relays hold no list though one was saved before', async () => {
    social().setContactsFromRelay({ tags: [['p', X]], content: '', createdAtSec: T });
    relaysHold();
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);
  });

  it('waits rather than build on old raw tags a newer seed with the same follows vouched for', async () => {
    // The saved raw list is older; a seed with the same people is newer, so the
    // saved fields decode as one list at the seed's time.
    social().setContactsFromRelay({
      tags: [['p', X, 'wss://old.example']],
      content: 'old',
      createdAtSec: T,
    });
    social().seedFollowsFromFacade({ follows: [X], createdAtSec: T + 10 });
    relaysHold(contacts(T, [['p', X, 'wss://old.example']], 'old'));
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);
  });

  it('drops the follow and shows the error when the signer refuses', async () => {
    relaysHold(contacts(T, [['p', X]]));
    const { ndk, signer } = setup();
    signer.sign.mockRejectedValueOnce(new Error('Denied'));

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey).toEqual({});
    expect(selectIsFollowingPubkey(Z)(social())).toBe(false);
    expect(mockPopup).toHaveBeenCalledWith('engagement-update-failed', 'follow');
  });

  it('keeps the follow while the account signer is not ready', async () => {
    relaysHold(contacts(T, [['p', X]]));
    const { ndk, signer } = setup();
    signer.user.mockResolvedValue({ pubkey: OTHER_ACCOUNT });

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);
    expect(mockPopup).not.toHaveBeenCalled();
  });

  it('settles a tap the list already agrees with, without publishing', async () => {
    relaysHold(
      contacts(T, [
        ['p', X],
        ['p', Z],
      ])
    );
    const { ndk } = setup();

    social().setFollowIntent(Z, true);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey).toEqual({});
  });
});

describe('an account with no follow list yet', () => {
  /** How the facade's aggregate read reports which sources have answered. */
  const provenance = (overrides: object = {}) => ({
    readId: 'r',
    sources: ['relay'],
    attempts: [],
    degraded: false,
    complete: true,
    ...overrides,
  });
  const graph = (follows: string[], contactsUpdatedAt: number, overrides: object = {}) => ({
    tier: 'relay',
    follows,
    contactsUpdatedAt,
    provenance: provenance(overrides),
  });

  it('publishes the first follow once every write relay and the indexers say there is none', async () => {
    relaysHold();
    mockLayer = { getSocialGraph: jest.fn(async () => ok(graph([], 0))) };
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(publishedTags()).toEqual([['p', Z]]);
    expect(mockLayer.getSocialGraph).toHaveBeenCalledWith(
      expect.objectContaining({ pubkey: OWN, refresh: true })
    );
  });

  it('publishes the first follow when no indexer is enabled and every write relay has none', async () => {
    relaysHold();
    mockLayer = null;
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(publishedTags()).toEqual([['p', Z]]);
  });

  it('publishes the first follow when every indexer says it has no list to serve', async () => {
    relaysHold();
    mockLayer = {
      getSocialGraph: jest.fn(async () =>
        err({
          type: 'all_tiers_exhausted',
          attempts: [
            { tier: 'nagg', outcome: 'unsupported' },
            { tier: 'primal', outcome: 'unsupported' },
          ],
        })
      ),
    };
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(publishedTags()).toEqual([['p', Z]]);
  });

  it('waits when an indexer knows a list the relays did not return', async () => {
    relaysHold();
    mockLayer = { getSocialGraph: jest.fn(async () => ok(graph([X, Y], T))) };
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);
    expect(social().followingPubkeys).toEqual({ [X]: true, [Y]: true });
  });

  it('waits for an indexer still answering, and for the list it then returns', async () => {
    relaysHold();
    mockLayer = {
      getSocialGraph: jest.fn(async ({ onUpdate }: { onUpdate?: (graph: object) => void }) => {
        // The first paint: the relay floor answered empty, Primal is pending.
        setTimeout(() =>
          onUpdate?.(graph([X, Y], T, { sources: ['relay', 'primal'], complete: true }))
        );
        return ok(graph([], 0, { complete: false, pending: ['primal'] }));
      }),
    };
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);
    expect(social().followingPubkeys).toEqual({ [X]: true, [Y]: true });
  });

  it('waits when an indexer failed to answer', async () => {
    relaysHold();
    mockLayer = {
      getSocialGraph: jest.fn(async () =>
        ok(
          graph([], 0, {
            degraded: true,
            attempts: [{ tier: 'primal', outcome: 'failed' }],
          })
        )
      ),
    };
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);
  });

  it('waits when the indexers do not answer', async () => {
    relaysHold();
    mockLayer = {
      getSocialGraph: jest.fn(async () =>
        err({
          type: 'all_tiers_exhausted',
          attempts: [
            { tier: 'nagg', outcome: 'unsupported' },
            { tier: 'primal', outcome: 'failed' },
          ],
        })
      ),
    };
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);
  });
});

describe('a follow saved before the app closed', () => {
  it('is resumed after the account loads, and the button keeps working', async () => {
    // The released (version 1) entry `releaseUpgrade.test.ts` carries: an
    // unfollow of a followed person, still pending when the app closed.
    mockDisk.set(
      'nostr-social-store',
      JSON.stringify({
        version: 1,
        state: {
          contactsTags: [
            ['p', X],
            ['p', Y],
          ],
          contactsContent: 'fixture',
          contactsUpdatedAt: T,
          followingPubkeys: { [X]: true, [Y]: true },
          optimisticFollowsByPubkey: { [X]: { value: false, pending: true, updatedAt: 3 } },
        },
      })
    );
    await useNostrSocialStore.persist.rehydrate();
    expect(selectIsFollowingPubkey(X)(social())).toBe(false);
    relaysHold(
      contacts(
        T,
        [
          ['p', X],
          ['p', Y],
        ],
        'fixture'
      )
    );
    const { ndk } = setup();

    await requestFollowSync(ndk, OWN);

    expect(mockPublish.mock.calls[0][0].event).toMatchObject({
      tags: [['p', Y]],
      content: 'fixture',
    });
    expect(social().optimisticFollowsByPubkey).toEqual({});

    tap(X);
    expect(selectIsFollowingPubkey(X)(social())).toBe(true);
    await requestFollowSync(ndk, OWN);
    expect(publishedTags(1)).toEqual([
      ['p', Y],
      ['p', X],
    ]);
  });
});

describe('switching account while a follow is being published', () => {
  it('writes nothing when the switch happens during the read', async () => {
    relaysHold(
      contacts(T + 10, [
        ['p', X],
        ['p', W],
      ])
    );
    social().setContactsFromRelay({ tags: [['p', X]], content: '', createdAtSec: T });
    const gate = deferred();
    mockReadGate = gate.promise;
    const { ndk } = setup();

    tap(Z);
    const run = requestFollowSync(ndk, OWN);
    for (let i = 0; i < 20 && mockFilters.length < mockRelays.length; i++) await Promise.resolve();
    expect(mockFilters).toHaveLength(mockRelays.length);
    switchAccount();
    const before = social();
    gate.resolve();
    await run;

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social()).toBe(before);
  });

  it('writes nothing when the switch happens during the publish', async () => {
    relaysHold(contacts(T, [['p', X]]));
    let before: ReturnType<typeof social> | undefined;
    mockPublish.mockImplementationOnce(async () => {
      switchAccount();
      before = social();
      return ok({});
    });
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(social()).toBe(before);
  });
});

describe('the plan', () => {
  it('applies only the intents, leaving every other entry as read', () => {
    const tags = [
      ['p', X, 'r'],
      ['e', 'x'],
      ['p', X, 'dup'],
      ['p', Y],
    ];
    expect(
      applyFollowIntents(tags, {
        [X]: { value: true, pending: true, updatedAt: 1 },
        [Y]: { value: false, pending: true, updatedAt: 1 },
        [Z]: { value: true, pending: true, updatedAt: 1 },
      })
    ).toEqual([
      ['p', X, 'r'],
      ['e', 'x'],
      ['p', X, 'dup'],
      ['p', Z],
    ]);
  });

  it('never treats a read that found nothing as an empty list without the indexers', () => {
    const intents = { [Z]: { value: true, pending: true, updatedAt: 1 } };
    const known = { status: 'unknown' } as const;
    expect(planFollowPublish({ intents, known, read: { status: 'empty' } })).toEqual({
      step: 'ask-indexers',
    });
    expect(planFollowPublish({ intents, known, read: { status: 'incomplete' } })).toEqual({
      step: 'wait',
      reason: 'read-incomplete',
    });
  });

  it('builds only on the list a complete read returned', () => {
    const intents = { [Z]: { value: true, pending: true, updatedAt: 1 } };
    const list = { tags: [['p', X]], content: 'c', createdAt: T };
    const saved = { status: 'known' as const, updatedAt: T };
    expect(planFollowPublish({ intents, known: saved, read: { status: 'incomplete' } })).toEqual({
      step: 'wait',
      reason: 'read-incomplete',
    });
    expect(planFollowPublish({ intents, known: saved, read: { status: 'found', list } })).toEqual({
      step: 'publish',
      base: list,
      tags: [
        ['p', X],
        ['p', Z],
      ],
    });
  });
});
