import type NDK from '@nostr-dev-kit/ndk-mobile';
import {
  decodeMuteList,
  publishReport,
  setPersonBlocked,
  syncMuteList,
} from '../shared/lib/nostr/moderation';
import { useFeedIgnoreStore } from '../features/feed/stores/ignoreStore';

const own = 'a'.repeat(64);
const target = 'b'.repeat(64);
const mockRelay = { url: 'wss://relay.example' };
const mockRelays = [mockRelay];
const mockProfile = {
  activeAccountIndex: 0,
  profiles: [
    { accountIndex: 0, pubkey: own },
    { accountIndex: 1, pubkey: target },
  ],
};
const mockListeners = new Set<(state: typeof mockProfile) => void>();
const mockPublish = jest.fn(async (..._args: unknown[]) => ({ isErr: () => false }));
let mockEventId = 100;

jest.mock(
  '@nostr-dev-kit/ndk-mobile',
  () => ({
    __esModule: true,
    default: class {},
    NDKSubscriptionCacheUsage: { ONLY_RELAY: 'ONLY_RELAY' },
    NDKRelaySet: {
      fromRelayUrls: (urls: string[]) => ({
        relays: new Set(mockRelays.filter((relay) => urls.includes(relay.url))),
      }),
    },
    NDKEvent: class {
      kind = 10000;
      pubkey = 'a'.repeat(64);
      created_at = 10;
      tags: string[][] = [];
      content = '';
      id = 'c'.repeat(64);
      getEventHash() {
        return this.id;
      }
      verifySignature() {
        return true;
      }
      async sign(signer: { user: () => Promise<{ pubkey: string }> }) {
        this.pubkey = (await signer.user()).pubkey;
        this.id = (++mockEventId).toString(16).padStart(64, '0');
      }
    },
  }),
  { virtual: true }
);
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: {
    getState: () => mockProfile,
    subscribe: (listener: (state: typeof mockProfile) => void) => {
      mockListeners.add(listener);
      return () => mockListeners.delete(listener);
    },
  },
}));
jest.mock('@/shared/lib/nostr/outbox/relayListStore', () => ({
  getOwnWriteRelays: () => mockRelays.map((relay) => relay.url),
}));
jest.mock('@/shared/lib/nostr/publish', () => ({
  publishEvent: (...args: unknown[]) => mockPublish(...args),
}));
jest.mock('@sovranbitcoin/schemas', () => ({ loggableIssues: () => [] }), { virtual: true });
jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn() },
  log: { warn: jest.fn() },
  redactError: () => '',
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

function setup(events: unknown[] = [], eose = true) {
  const listeners: Record<string, (...args: unknown[]) => void> = {};
  const subscription = {
    eosesSeen: new Set(eose ? [mockRelay] : []),
    stop: jest.fn(),
    on: (type: string, listener: (...args: unknown[]) => void) => {
      listeners[type] = listener;
    },
    start: jest.fn(async () => {
      for (const event of events) listeners.event(event);
      if (eose) listeners.eose();
    }),
  };
  const signer = {
    user: jest.fn(async () => ({ pubkey: own })),
    decrypt: jest.fn(async (_user: unknown, content: string) => content),
    encrypt: jest.fn(async (_user: unknown, content: string) => content),
  };
  const ndk = {
    signer,
    getUser: (params: unknown) => params,
    subscribe: () => subscription,
  } as unknown as NDK;
  return { ndk, signer, subscription, listeners };
}

function event(overrides: Record<string, unknown> = {}) {
  const { NDKEvent } = jest.requireMock('@nostr-dev-kit/ndk-mobile');
  return Object.assign(new NDKEvent(), overrides);
}

beforeEach(() => {
  mockRelays.splice(0, mockRelays.length, mockRelay);
  mockProfile.activeAccountIndex = 0;
  mockPublish.mockClear();
  useFeedIgnoreStore.setState(useFeedIgnoreStore.getInitialState(), true);
});
afterEach(() => {
  jest.useRealTimers();
  expect(mockListeners.size).toBe(0);
});

it('restores encrypted blocks and chooses the lowest ID for equal timestamps', async () => {
  const { ndk } = setup([
    event({ id: 'f'.repeat(64), tags: [['p', own]] }),
    event({ id: 'd'.repeat(64), content: JSON.stringify([['p', target]]) }),
  ]);
  await syncMuteList(ndk, own);
  expect(useFeedIgnoreStore.getState().ignoredPubkeys).toEqual([target]);
});

it('does not overwrite encrypted lists if decryption fails', async () => {
  const { ndk, signer } = setup([event({ content: 'unreadable' })]);
  signer.decrypt.mockRejectedValueOnce(new Error('Denied'));
  await expect(setPersonBlocked(ndk, own, target, true)).rejects.toThrow();
  expect(mockPublish).not.toHaveBeenCalled();
  expect(useFeedIgnoreStore.getState().ignoredPubkeys).toEqual([target]);
});

it('times out and stops subscriptions; an empty timed-out read cannot create a list', async () => {
  jest.useFakeTimers();
  const { ndk, subscription } = setup([], false);
  const result = expect(setPersonBlocked(ndk, own, target, true)).rejects.toThrow('timed out');
  await jest.advanceTimersByTimeAsync(12_001);
  await result;
  expect(subscription.stop).toHaveBeenCalled();
  expect(mockPublish).not.toHaveBeenCalled();
});

it('creates the first encrypted block list without a second confirmation after relay reads finish', async () => {
  const { ndk } = setup();
  await setPersonBlocked(ndk, own, target, true);
  expect(mockPublish).toHaveBeenCalledTimes(1);
  expect(useFeedIgnoreStore.getState().blockOverrides).toEqual({});
});

it('keeps a first block local when configured relays have not confirmed an empty list', async () => {
  jest.useFakeTimers();
  const { ndk, subscription } = setup();
  subscription.eosesSeen.clear();
  subscription.eosesSeen.add({ url: 'wss://some-other-relay.example' });
  const result = expect(setPersonBlocked(ndk, own, target, true)).rejects.toThrow();
  await jest.advanceTimersByTimeAsync(12_001);
  await result;
  expect(mockPublish).not.toHaveBeenCalled();
  expect(useFeedIgnoreStore.getState().ignoredPubkeys).toEqual([target]);
});

function setupDelayedRelay() {
  const slowRelay = { url: 'wss://slow.example' };
  mockRelays.push(slowRelay);
  const fast = setup([event({ tags: [['t', 'old']] })]);
  const slow = setup([], false);
  const ndk = {
    ...fast.ndk,
    subscribe: (_filter: unknown, _options: unknown, relays: { relays: Set<typeof mockRelay> }) =>
      relays.relays.size === 1 && relays.relays.has(slowRelay)
        ? slow.subscription
        : fast.subscription,
  } as unknown as NDK;
  return { ndk, fast, slow, slowRelay };
}

it('waits for the slower relay and preserves its newer private blocks and unfamiliar tags', async () => {
  const { ndk, fast, slow, slowRelay } = setupDelayedRelay();
  const result = setPersonBlocked(ndk, own, target, true);
  // Wait until both subscriptions have started, without resolving the slow one.
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(slow.subscription.start).toHaveBeenCalled();
  expect(mockPublish).not.toHaveBeenCalled();
  const existing = 'd'.repeat(64);
  slow.listeners.event(
    event({
      created_at: 20,
      tags: [['t', 'keep-this-tag']],
      content: JSON.stringify([
        ['p', existing],
        ['word', 'keep-private'],
      ]),
    })
  );
  slow.subscription.eosesSeen.add(slowRelay);
  slow.listeners.eose();
  await result;
  expect(useFeedIgnoreStore.getState().ignoredPubkeys).toEqual([target, existing]);
  const published = mockPublish.mock.calls[0][0] as {
    event: { tags: string[][]; content: string };
  };
  expect(published.event.tags).toEqual([['t', 'keep-this-tag']]);
  expect(JSON.parse(published.event.content)).toEqual(
    expect.arrayContaining([
      ['p', existing],
      ['p', target],
      ['word', 'keep-private'],
    ])
  );
  expect(fast.subscription.stop).toHaveBeenCalled();
  expect(slow.subscription.stop).toHaveBeenCalled();
});

it('keeps a block pending and publishes nothing if a relay stalls after another returns an old list', async () => {
  jest.useFakeTimers();
  const { ndk, fast, slow } = setupDelayedRelay();
  const result = expect(setPersonBlocked(ndk, own, target, true)).rejects.toThrow('timed out');
  await jest.advanceTimersByTimeAsync(12_001);
  await result;
  expect(mockPublish).not.toHaveBeenCalled();
  expect(useFeedIgnoreStore.getState().ignoredPubkeys).toEqual([target]);
  expect(useFeedIgnoreStore.getState().blockOverrides).toEqual({ [target]: true });
  expect(fast.subscription.stop).toHaveBeenCalled();
  expect(slow.subscription.stop).toHaveBeenCalled();
});

it('rejects stale-account signers without publishing under the wrong identity', async () => {
  const { ndk, signer } = setup();
  signer.user.mockResolvedValue({ pubkey: target });
  await expect(publishReport(ndk, own, target, 'spam')).rejects.toThrow('signer');
  expect(mockPublish).not.toHaveBeenCalled();
});

it('ignores reads after switching away and back, while allowing ordinary profile metadata changes', async () => {
  const { ndk, signer } = setup([event({ tags: [['p', target]] })]);
  signer.user.mockImplementationOnce(async () => {
    for (const index of [1, 0]) {
      mockProfile.activeAccountIndex = index;
      for (const listener of mockListeners) listener(mockProfile);
    }
    return { pubkey: own };
  });
  await expect(syncMuteList(ndk, own)).rejects.toThrow('Profile changed');
  expect(useFeedIgnoreStore.getState().ignoredPubkeys).toEqual([]);
  signer.user.mockImplementationOnce(async () => {
    mockProfile.profiles = mockProfile.profiles.slice();
    for (const listener of mockListeners) listener(mockProfile);
    return { pubkey: own };
  });
  await syncMuteList(ndk, own);
  expect(useFeedIgnoreStore.getState().ignoredPubkeys).toEqual([target]);
});

it('does not overwrite a newer list learned while the signer was open', async () => {
  const { ndk, signer } = setup([event()]);
  signer.encrypt.mockImplementationOnce(async (_user, content) => {
    useFeedIgnoreStore.getState().receiveMuteList({
      id: 'e'.repeat(64),
      createdAt: 20,
      tags: [['t', 'preserve']],
      privateTags: [],
    });
    return content;
  });
  await expect(setPersonBlocked(ndk, own, target, true)).rejects.toThrow('Mute list changed');
  expect(mockPublish).not.toHaveBeenCalled();
  expect(useFeedIgnoreStore.getState().blockOverrides[target]).toBe(true);
});

it('rejects invalid IDs, timestamps and signatures before parsing a list', async () => {
  const { ndk } = setup();
  for (const bad of [
    event({ created_at: -1 }),
    event({ created_at: 1.5 }),
    event({ getEventHash: () => 'different' }),
    event({ verifySignature: () => false }),
  ]) {
    await expect(decodeMuteList(ndk, bad, own)).rejects.toThrow('Invalid mute list');
  }
});

it('never falls back to an older list when the newest authenticated list is unsupported', async () => {
  for (const newest of [
    event({ created_at: 20, content: 'x'.repeat(1_000_001) }),
    event({ created_at: Math.floor(Date.now() / 1000) + 3600 }),
  ]) {
    const { ndk } = setup([event(), newest]);
    await expect(setPersonBlocked(ndk, own, target, true)).rejects.toThrow('Unsupported mute list');
    expect(mockPublish).not.toHaveBeenCalled();
  }
});
