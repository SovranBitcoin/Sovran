/**
 * @jest-environment node
 *
 * What tapping Follow publishes: the tap records an intent in the real social
 * store and the follow worker (`followSync`) turns outstanding intents into one
 * follow list built on the newest list it can vouch for. Replaced: the relays
 * (a fake NDK subscription per write relay), the publish seam, the signer, the
 * active account, the indexers, the popup and storage; for the hook, also the
 * keys, NDK and offline providers and AppState.
 *
 * The fakes behave like relays for what is proven here: each relay holds its
 * own lists, a read asks one relay, and a publish lands only on the relays it
 * was sent to (with none named, every relay in the pool, as `publishEvent`
 * does).
 */
import type NDK from '@nostr-dev-kit/ndk-mobile';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { err, ok } from 'neverthrow';

import {
  applyFollowIntents,
  planFollowPublish,
  requestFollowSync,
} from '@/shared/lib/nostr/followSync';
import { DEFAULT_RELAYS } from '@/shared/lib/nostr/outbox/defaults';
import { useRelayListStore } from '@/shared/lib/nostr/outbox/relayListStore';
import { useFollowSync } from '@/shared/lib/nostr/ownsync/useFollowSync';
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

/** The account's write relays. */
const mockRelays: Relay[] = [{ url: 'wss://one.example' }, { url: 'wss://two.example' }];
/** Relays in the pool that are not write relays. */
const mockPoolOnly: Relay[] = [];
/** Each relay's stored kind 3s; a relay missing here never answers. */
const mockStored = new Map<string, RelayEvent[]>();
/** Relays that answer reads but refuse every publish. */
const mockRefusing = new Set<string>();
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
let mockHookNdk: NDK | null = null;
let mockOffline = false;

jest.mock('@nostr-dev-kit/ndk-mobile', () => ({
  __esModule: true,
  default: class {},
  useNDK: () => ({ ndk: mockHookNdk }),
  NDKSubscriptionCacheUsage: { ONLY_RELAY: 'ONLY_RELAY' },
  NDKRelaySet: {
    fromRelayUrls: (urls: string[]) => ({
      relays: new Set([...mockRelays, ...mockPoolOnly].filter((relay) => urls.includes(relay.url))),
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
jest.mock('@/shared/stores/global/profileStore', () => {
  const useProfileStore = {
    getState: () => mockProfile,
    subscribe: (listener: (state: typeof mockProfile) => void) => {
      mockProfileListeners.add(listener);
      return () => mockProfileListeners.delete(listener);
    },
  };
  return {
    useProfileStore,
    ...jest
      .requireActual<typeof import('./helpers/profileStoreMock')>('./helpers/profileStoreMock')
      .activeAccountReaders(() => useProfileStore.getState(), useProfileStore.subscribe),
  };
});
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
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: { pubkey: 'a0'.repeat(32) } }),
}));
jest.mock('@/shared/providers/NostrNDKProvider', () => ({
  useNostrNDKContext: () => ({ isInitialized: true }),
}));
jest.mock('@/shared/providers/OfflineProvider', () => ({
  useOfflineStatus: () => ({ isOffline: mockOffline }),
}));
jest.mock('react-native-web/dist/exports/AppState', () => ({
  __esModule: true,
  default: { addEventListener: () => ({ remove: () => undefined }) },
}));
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

/** The own-events sync taking in a list a relay sent. */
function saveList(event: RelayEvent) {
  social().setContactsFromRelay({
    tags: event.tags,
    content: event.content,
    createdAtSec: event.created_at,
    eventId: event.id,
  });
}

function relayEvent(raw: RelayEvent) {
  const { NDKEvent } = jest.requireMock('@nostr-dev-kit/ndk-mobile');
  return Object.assign(new NDKEvent(), raw);
}

/** Every write relay answers with these events (none: they answer that they hold no list). */
function relaysHold(...events: RelayEvent[]) {
  for (const relay of mockRelays) mockStored.set(relay.url, events);
}

/** What one relay holds. */
function heldBy(url: string): RelayEvent[] {
  return mockStored.get(url) ?? [];
}

/**
 * The publish seam: the list lands on each relay it is sent to (with none
 * named, every relay in the pool) that answers and does not refuse it.
 */
async function acceptOnRelays({ event, relays }: { event: RelayEvent; relays?: string[] }) {
  const targets = relays?.length
    ? relays
    : [...mockRelays, ...mockPoolOnly].map((relay) => relay.url);
  const accepted = targets.filter((url) => mockStored.has(url) && !mockRefusing.has(url));
  for (const url of accepted) mockStored.set(url, [...heldBy(url), { ...event }]);
  if (accepted.length === 0) return err({ type: 'all-failed', relayResults: [] });
  return ok({ accepted: accepted.map((url) => ({ url, ok: true })) });
}

/** This session's relay-list sync finding the account's list. */
function discoverRelays(relays: Relay[], createdAt: number) {
  useRelayListStore.getState().setFromRelay(
    relays.map((relay) => ({ url: relay.url, read: true, write: true })),
    createdAt
  );
  useRelayListStore.getState().markDiscovered(OWN);
}

function setup() {
  const signer = {
    sign: jest.fn(async () => undefined),
    user: jest.fn(async () => ({ pubkey: OWN })),
  };
  const connectListeners = new Set<(relay: Relay) => void>();
  const pool = {
    on: (type: string, listener: (relay: Relay) => void) => {
      if (type === 'relay:connect') connectListeners.add(listener);
    },
    off: (type: string, listener: (relay: Relay) => void) => {
      if (type === 'relay:connect') connectListeners.delete(listener);
    },
    /** A relay in the pool (re)connects. */
    connect: (relay: Relay) => {
      for (const listener of connectListeners) listener(relay);
    },
  };
  const ndk = {
    signer,
    pool,
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
  return { ndk, signer, pool };
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
  mockPoolOnly.length = 0;
  mockRefusing.clear();
  mockFilters.length = 0;
  mockReadGate = Promise.resolve();
  mockProfile.activeAccountIndex = 0;
  mockPublish.mockReset();
  mockPublish.mockImplementation(acceptOnRelays);
  mockPopup.mockReset();
  mockLayer = null;
  mockHookNdk = null;
  mockOffline = false;
  mockDisk.clear();
  useNostrSocialStore.setState(useNostrSocialStore.getInitialState(), true);
  await useNostrSocialStore.persist.rehydrate();
  useRelayListStore.setState(useRelayListStore.getInitialState(), true);
  await useRelayListStore.persist.rehydrate();
  // The account's relay list, as this session's relay-list sync takes it in.
  discoverRelays(mockRelays, T);
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
    saveList(contacts(T, tags, '{"relays":1}'));
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
      eventId: mockPublish.mock.calls[0][0].event.id,
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
    saveList(contacts(T, [['p', X]]));
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

  it('sends the list only to the relays it read, never over a list on another relay in the pool', async () => {
    relaysHold(contacts(T, [['p', X]]));
    // A relay in the pool, not a write relay, holds a newer list the read never asked.
    const other = { url: 'wss://three.example' };
    mockPoolOnly.push(other);
    const newer = contacts(T + 10, [
      ['p', X],
      ['p', W],
    ]);
    mockStored.set(other.url, [newer]);
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish.mock.calls[0][0].relays).toEqual(mockRelays.map((relay) => relay.url));
    expect(heldBy(other.url)).toEqual([newer]);
    for (const relay of mockRelays) expect(heldBy(relay.url)).toHaveLength(2);
  });

  it('unfollows by removing only that entry', async () => {
    const tags = [
      ['p', X, 'wss://hint.example'],
      ['t', 'bitcoin'],
      ['p', Y, '', 'yolanda'],
    ];
    relaysHold(contacts(T, tags));
    saveList(contacts(T, tags));
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
    saveList(
      contacts(T, [
        ['p', X, 'wss://hint.example'],
        ['p', Y],
      ])
    );
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

  it('settles a follow one write relay took, and the next one brings the other relay up to it', async () => {
    relaysHold(contacts(T, [['p', X]]));
    mockRefusing.add(mockRelays[1].url);
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(social().optimisticFollowsByPubkey).toEqual({});
    expect(heldBy(mockRelays[1].url)).toHaveLength(1);

    mockRefusing.clear();
    tap(Y);
    await requestFollowSync(ndk, OWN);

    // Built on the list relay one took, though relay two still answers with the older one.
    expect(publishedTags(1)).toEqual([
      ['p', X],
      ['p', Z],
      ['p', Y],
    ]);
    for (const relay of mockRelays)
      expect(heldBy(relay.url).at(-1)?.tags).toEqual(publishedTags(1));
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
    saveList(contacts(T, [['p', X]]));
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
    saveList(contacts(T, [['p', X]]));
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
    saveList(contacts(T, [['p', X, 'wss://old.example']], 'old'));
    social().seedFollowsFromFacade({ follows: [X], createdAtSec: T + 10 });
    relaysHold(contacts(T, [['p', X, 'wss://old.example']], 'old'));
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);
  });

  it('keeps the follow, without an error, when signing fails', async () => {
    // The app's only signer is the local key: a failure is never a refusal.
    relaysHold(contacts(T, [['p', X]]));
    const { ndk, signer } = setup();
    signer.sign.mockRejectedValueOnce(new Error('Signing timed out'));

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]).toMatchObject({ value: true, pending: true });
    expect(mockPopup).not.toHaveBeenCalled();

    await requestFollowSync(ndk, OWN);
    expect(publishedTags()).toEqual([
      ['p', X],
      ['p', Z],
    ]);
    expect(social().optimisticFollowsByPubkey).toEqual({});
  });

  it('does not sign with a signer replaced during the read', async () => {
    relaysHold(contacts(T, [['p', X]]));
    const gate = deferred();
    mockReadGate = gate.promise;
    const { ndk, signer } = setup();
    const replacement = { sign: jest.fn(async () => undefined), user: signer.user };

    tap(Z);
    const run = requestFollowSync(ndk, OWN);
    for (let i = 0; i < 20 && mockFilters.length < mockRelays.length; i++) await Promise.resolve();
    (ndk as unknown as { signer: unknown }).signer = replacement;
    gate.resolve();
    await run;

    expect(signer.sign).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);
  });

  it('keeps the follow when the signer is replaced while signing', async () => {
    relaysHold(contacts(T, [['p', X]]));
    const { ndk, signer } = setup();
    signer.sign.mockImplementationOnce(async () => {
      (ndk as unknown as { signer: unknown }).signer = undefined;
      throw new Error('Signer closed');
    });

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);
    expect(mockPopup).not.toHaveBeenCalled();
  });

  it('does not mark the follow done when the signer is replaced while publishing', async () => {
    relaysHold(contacts(T, [['p', X]]));
    const { ndk, signer } = setup();
    mockPublish.mockImplementationOnce(async (args: { event: RelayEvent }) => {
      (ndk as unknown as { signer: unknown }).signer = { ...signer };
      return acceptOnRelays(args);
    });

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);
    expect(social().followingPubkeys).toEqual({ [X]: true });

    // The next pass finds the published list holds the follow.
    await requestFollowSync(ndk, OWN);
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(social().optimisticFollowsByPubkey).toEqual({});
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

  it('builds again on a list with the same time that arrived while signing', async () => {
    relaysHold(contacts(T, [['p', X]]));
    // Another client's list with the same second and a lower id: relays keep it.
    const rival = {
      ...contacts(T, [
        ['p', X],
        ['p', W],
      ]),
      id: '1'.padStart(64, '0'),
    };
    const { ndk, signer } = setup();
    signer.sign.mockImplementationOnce(async () => {
      mockStored.set(mockRelays[1].url, [contacts(T, [['p', X]]), rival]);
      saveList(rival);
    });

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(publishedTags()).toEqual([
      ['p', X],
      ['p', W],
      ['p', Z],
    ]);
    expect(social().optimisticFollowsByPubkey).toEqual({});
  });

  it('keeps the follow and builds again when a newer list arrives during the publish', async () => {
    const now = Math.floor(Date.now() / 1000);
    relaysHold(contacts(now - 100, [['p', X]]));
    const newer = contacts(now + 30, [
      ['p', X],
      ['p', W],
    ]);
    mockPublish.mockImplementationOnce(async (args: { event: RelayEvent }) => {
      await acceptOnRelays(args);
      // Another client's list, dated after ours, lands before ours is recorded.
      for (const relay of mockRelays) mockStored.set(relay.url, [newer]);
      saveList(newer);
      return ok({});
    });
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).toHaveBeenCalledTimes(2);
    expect(publishedTags(1)).toEqual([
      ['p', X],
      ['p', W],
      ['p', Z],
    ]);
    expect(social().followingPubkeys).toEqual({ [X]: true, [W]: true, [Z]: true });
    expect(social().optimisticFollowsByPubkey).toEqual({});
  });

  it('keeps the follow when a list from the same second arrives during the publish', async () => {
    relaysHold(contacts(T, [['p', X]]));
    mockPublish.mockImplementationOnce(async (args: { event: RelayEvent }) => {
      await acceptOnRelays(args);
      // Same second as ours, lower id: relays keep it over ours.
      const rival = {
        ...contacts(args.event.created_at, [
          ['p', X],
          ['p', W],
        ]),
        id: '0'.repeat(64),
      };
      for (const relay of mockRelays) mockStored.get(relay.url)!.push(rival);
      saveList(rival);
      return ok({});
    });
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).toHaveBeenCalledTimes(2);
    expect(publishedTags(1)).toEqual([
      ['p', X],
      ['p', W],
      ['p', Z],
    ]);
    expect(social().optimisticFollowsByPubkey).toEqual({});
  });

  it('keeps a list from the same second with a lower id over the one the write relays return', async () => {
    const loser = { ...contacts(T, [['p', X]]), id: '9'.repeat(64) };
    const winner = {
      ...contacts(T, [
        ['p', X],
        ['p', W],
      ]),
      id: '1'.repeat(64),
    };
    // The own-events sync took in the winner from a relay the write relays are not.
    saveList(winner);
    relaysHold(loser);
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);
    expect(social().contactsTags).toEqual(winner.tags);
    expect(social().followingPubkeys).toEqual({ [X]: true, [W]: true });
  });

  it('waits when a saved list from the same second differs from the read and its id is not known', async () => {
    // Saved by an earlier session: the store keeps no id.
    mockDisk.set(
      'nostr-social-store',
      JSON.stringify({
        version: 2,
        state: {
          contactsTags: [
            ['p', X],
            ['p', W],
          ],
          contactsContent: '',
          contactsUpdatedAt: T,
          followingPubkeys: { [X]: true, [W]: true },
        },
      })
    );
    await useNostrSocialStore.persist.rehydrate();
    relaysHold(contacts(T, [['p', X]]));
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().contactsTags).toEqual([
      ['p', X],
      ['p', W],
    ]);
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);
  });

  it('keeps waiting when the own-events sync brings a different list from the same second as one saved without its id', async () => {
    // Saved by an earlier session: the store keeps no id.
    const savedTags = [
      ['p', X],
      ['p', W],
    ];
    mockDisk.set(
      'nostr-social-store',
      JSON.stringify({
        version: 2,
        state: {
          contactsTags: savedTags,
          contactsContent: '',
          contactsUpdatedAt: T,
          followingPubkeys: { [X]: true, [W]: true },
        },
      })
    );
    await useNostrSocialStore.persist.rehydrate();
    const other = { ...contacts(T, [['p', X]]), id: '9'.repeat(64) };
    relaysHold(other);
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);
    expect(mockPublish).not.toHaveBeenCalled();

    saveList(other);
    expect(social().contactsTags).toEqual(savedTags);
    expect(social().followingPubkeys).toEqual({ [X]: true, [W]: true });
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);
  });

  it('waits rather than build on a list dated in the future', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    relaysHold(contacts(future, [['p', X]]));
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);
    expect(social().contactsUpdatedAt).toBe(0);
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

describe("the account's relay list", () => {
  /** The relay-list store as it is before the account's list has loaded. */
  async function relayListNotLoaded() {
    useRelayListStore.setState(useRelayListStore.getInitialState(), true);
    await useRelayListStore.persist.rehydrate();
  }

  it('reads and publishes nothing until the relay list is known, then builds on its relays', async () => {
    await relayListNotLoaded();
    // The defaults answer with an old list; the account's own relays hold the newer one.
    for (const url of DEFAULT_RELAYS) {
      mockPoolOnly.push({ url });
      mockStored.set(url, [contacts(T - 100, [['p', X]])]);
    }
    const newer = contacts(T, [
      ['p', X],
      ['p', W],
    ]);
    relaysHold(newer);
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockFilters).toEqual([]);
    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);

    discoverRelays(mockRelays, T);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish.mock.calls[0][0].relays).toEqual(mockRelays.map((relay) => relay.url));
    expect(publishedTags()).toEqual([
      ['p', X],
      ['p', W],
      ['p', Z],
    ]);
    for (const url of DEFAULT_RELAYS) expect(heldBy(url)).toHaveLength(1);
  });

  it("waits after a restart until this session's relay-list discovery has run, then builds on the relays it found", async () => {
    // An earlier session saved the account's relay list; another device has
    // since moved the account to other relays and published a newer follow list there.
    const old = { url: 'wss://old.example' };
    mockPoolOnly.push(old);
    mockStored.set(old.url, [contacts(T - 100, [['p', X]])]);
    relaysHold(
      contacts(T, [
        ['p', X],
        ['p', W],
      ])
    );
    useRelayListStore.setState(useRelayListStore.getInitialState(), true);
    mockDisk.set(
      'nostr-relay-list-store',
      JSON.stringify({
        version: 0,
        state: {
          entries: [{ url: old.url, read: true, write: true }],
          updatedAt: T - 100,
          hasPublished: true,
          source: 'relay',
        },
      })
    );
    await useRelayListStore.persist.rehydrate();
    expect(useRelayListStore.getState().entries).toEqual([
      { url: old.url, read: true, write: true },
    ]);
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockFilters).toEqual([]);
    expect(mockPublish).not.toHaveBeenCalled();
    expect(heldBy(old.url)).toHaveLength(1);
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);

    discoverRelays(mockRelays, T);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish.mock.calls[0][0].relays).toEqual(mockRelays.map((relay) => relay.url));
    expect(publishedTags()).toEqual([
      ['p', X],
      ['p', W],
      ['p', Z],
    ]);
    expect(heldBy(old.url)).toHaveLength(1);
  });

  it('uses the defaults once the sync found no relay list for the account', async () => {
    await relayListNotLoaded();
    for (const url of DEFAULT_RELAYS) {
      mockPoolOnly.push({ url });
      mockStored.set(url, [contacts(T, [['p', X]])]);
    }
    useRelayListStore.getState().markDiscovered(OTHER_ACCOUNT);
    const { ndk } = setup();

    tap(Z);
    await requestFollowSync(ndk, OWN);
    expect(mockPublish).not.toHaveBeenCalled();

    useRelayListStore.getState().markDiscovered(OWN);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish.mock.calls[0][0].relays).toEqual([...DEFAULT_RELAYS]);
    expect(publishedTags()).toEqual([
      ['p', X],
      ['p', Z],
    ]);
  });

  it('reads again when the write relays change between the read and the publish', async () => {
    relaysHold(contacts(T, [['p', X]]));
    const added = { url: 'wss://three.example' };
    mockPoolOnly.push(added);
    const newer = contacts(T + 10, [
      ['p', X],
      ['p', W],
    ]);
    mockStored.set(added.url, [newer]);
    const { ndk, signer } = setup();
    // The relay-list sync takes in a newer relay list while the follow is signed.
    signer.sign.mockImplementationOnce(async () => {
      useRelayListStore.getState().setFromRelay(
        [...mockRelays, added].map((relay) => ({ url: relay.url, read: true, write: true })),
        T + 1
      );
    });

    tap(Z);
    await requestFollowSync(ndk, OWN);

    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish.mock.calls[0][0].relays).toEqual([
      ...mockRelays.map((relay) => relay.url),
      added.url,
    ]);
    expect(publishedTags()).toEqual([
      ['p', X],
      ['p', W],
      ['p', Z],
    ]);
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

  it('gives up on an indexer whose last update never comes, and keeps the follow', async () => {
    jest.useFakeTimers();
    relaysHold();
    mockLayer = {
      // The first paint says a source is still pending; no later update arrives.
      getSocialGraph: jest.fn(async () =>
        ok(graph([], 0, { complete: false, pending: ['primal'] }))
      ),
    };
    const { ndk } = setup();

    tap(Z);
    let stopped = false;
    void requestFollowSync(ndk, OWN).then(() => (stopped = true));
    await jest.advanceTimersByTimeAsync(10_000);
    expect(stopped).toBe(false);
    await jest.advanceTimersByTimeAsync(5_001);

    expect(stopped).toBe(true);
    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);
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

describe('the follow sync hook with the real worker', () => {
  it('publishes a follow tapped offline once the network is back, and the next tap after it', async () => {
    relaysHold(contacts(T, [['p', X]]));
    const { ndk } = setup();
    mockHookNdk = ndk;
    mockOffline = true;
    const view = renderHook(() => useFollowSync());

    act(() => tap(Z));
    await act(async () => undefined);
    expect(mockPublish).not.toHaveBeenCalled();

    mockOffline = false;
    view.rerender({});
    await waitFor(() => expect(social().optimisticFollowsByPubkey).toEqual({}));
    expect(publishedTags()).toEqual([
      ['p', X],
      ['p', Z],
    ]);

    act(() => tap(X));
    await waitFor(() => expect(mockPublish).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(social().optimisticFollowsByPubkey).toEqual({}));
    expect(publishedTags(1)).toEqual([['p', Z]]);
    view.unmount();
  });
});

describe('what wakes a waiting follow', () => {
  it('the saved list itself, with its id, from the own-events sync', async () => {
    // Saved by an earlier session, with no id; the relays hold a different list
    // from that second, with a lower id, so they keep it over the saved one.
    // Only the saved list's own event may tell the store its id (a different
    // list from that second is not taken in: see "keeps waiting when ...").
    mockDisk.set(
      'nostr-social-store',
      JSON.stringify({
        version: 2,
        state: {
          contactsTags: [['p', W]],
          contactsUpdatedAt: T,
          followingPubkeys: { [W]: true },
        },
      })
    );
    await useNostrSocialStore.persist.rehydrate();
    const saved = { ...contacts(T, [['p', W]]), id: '9'.repeat(64) };
    relaysHold({ ...contacts(T, [['p', X]]), id: '1'.repeat(64) });
    const { ndk } = setup();
    mockHookNdk = ndk;
    const view = renderHook(() => useFollowSync());

    act(() => tap(Z));
    await act(async () => undefined);
    expect(mockPublish).not.toHaveBeenCalled();

    act(() => saveList(saved));
    await waitFor(() => expect(mockPublish).toHaveBeenCalledTimes(1));
    expect(publishedTags()).toEqual([
      ['p', X],
      ['p', Z],
    ]);
    view.unmount();
  });

  it('a write relay connecting after it did not answer', async () => {
    jest.useFakeTimers();
    mockStored.set(mockRelays[0].url, [contacts(T, [['p', X]])]);
    const { ndk, pool } = setup();
    mockHookNdk = ndk;
    const view = renderHook(() => useFollowSync());

    act(() => tap(Z));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(12_001);
    });
    expect(mockPublish).not.toHaveBeenCalled();

    // Relay two is back and answers now.
    mockStored.set(mockRelays[1].url, [contacts(T, [['p', X]])]);
    await act(async () => pool.connect({ url: 'wss://elsewhere.example' }));
    expect(mockPublish).not.toHaveBeenCalled();
    await act(async () => pool.connect(mockRelays[1]));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(publishedTags()).toEqual([
      ['p', X],
      ['p', Z],
    ]);
    view.unmount();
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
    saveList(contacts(T, [['p', X]]));
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
    const list = { tags: [['p', X]], content: 'c', createdAt: T, id: '5'.repeat(64) };
    const saved = { status: 'known' as const, updatedAt: T, eventId: list.id };
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
