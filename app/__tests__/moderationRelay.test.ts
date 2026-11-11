import type NDK from '@nostr-dev-kit/ndk-mobile';
import {
  decodeMuteList,
  publishReport,
  setPersonBlocked,
  syncMuteList,
} from '../shared/lib/nostr/moderation';
import { useFeedIgnoreStore } from '../features/feed/stores/ignoreStore';
import { asNostrPubkeyHex } from '../shared/lib/protocolIds';
import {
  SILENT_READS_BEFORE_LEFT_OUT,
  forgetSilentRelays,
} from '../shared/lib/nostr/ownReplaceableEvent';

const own = 'a'.repeat(64);
const target = asNostrPubkeyHex('b'.repeat(64));
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
/** Whether this session's relay-list sync has found the account's relays. */
let mockDiscovered = true;
const mockPublish = jest.fn(async (..._args: unknown[]) => ({ isErr: () => false }));
let mockEventId = 100;

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
}));
jest.mock('@/shared/stores/global/profileStore', () => {
  const useProfileStore = {
    getState: () => mockProfile,
    subscribe: (listener: (state: typeof mockProfile) => void) => {
      mockListeners.add(listener);
      return () => mockListeners.delete(listener);
    },
  };
  return {
    useProfileStore,
    ...jest
      .requireActual<typeof import('./helpers/profileStoreMock')>('./helpers/profileStoreMock')
      .activeAccountReaders(() => useProfileStore.getState(), useProfileStore.subscribe),
  };
});
jest.mock('@/shared/lib/nostr/outbox/relayListStore', () => ({
  getOwnWriteRelays: () => mockRelays.map((relay) => relay.url),
  getKnownOwnWriteRelays: () => (mockDiscovered ? mockRelays.map((relay) => relay.url) : null),
}));
jest.mock('@/shared/lib/nostr/publish', () => ({
  publishEvent: (...args: unknown[]) => mockPublish(...args),
}));
jest.mock('@sovranbitcoin/schemas', () => ({ loggableIssues: () => [] }), { virtual: true });
jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn() },
  nostrLog: { info: jest.fn(), warn: jest.fn() },
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

/** Let `reads` reads end, each by a relay's silence (12 s). */
async function readsTimeOut(reads: number) {
  for (let read = 0; read < reads; read++) await jest.advanceTimersByTimeAsync(12_001);
}

beforeEach(() => {
  forgetSilentRelays();
  mockDiscovered = true;
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
  // The only relay is read again until it counts as silent, and once more:
  // with no other relay there is nothing to read without it.
  await readsTimeOut(SILENT_READS_BEFORE_LEFT_OUT + 1);
  await result;
  expect(subscription.start).toHaveBeenCalledTimes(SILENT_READS_BEFORE_LEFT_OUT + 1);
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
  await readsTimeOut(SILENT_READS_BEFORE_LEFT_OUT + 1);
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

it('keeps a block pending while a relay stalls after another returns an old list, then publishes without it', async () => {
  jest.useFakeTimers();
  const { ndk, fast, slow, slowRelay } = setupDelayedRelay();
  const result = setPersonBlocked(ndk, own, target, true);
  await readsTimeOut(SILENT_READS_BEFORE_LEFT_OUT - 1);
  expect(mockPublish).not.toHaveBeenCalled();
  expect(useFeedIgnoreStore.getState().ignoredPubkeys).toEqual([target]);
  expect(useFeedIgnoreStore.getState().blockOverrides).toEqual({ [target]: true });
  expect(fast.subscription.stop).toHaveBeenCalled();
  expect(slow.subscription.stop).toHaveBeenCalled();

  // Silent three reads in a row: the next read goes without it, and the list
  // is sent only to the relay read. A newer list only the slow relay holds is
  // overruled, the risk the owner accepted (F227).
  await readsTimeOut(1);
  await result;
  expect(mockPublish).toHaveBeenCalledTimes(1);
  const published = mockPublish.mock.calls[0][0] as {
    relays: string[];
    event: { tags: string[][] };
  };
  expect(published.relays).toEqual([mockRelay.url]);
  expect(published.relays).not.toContain(slowRelay.url);
  expect(published.event.tags).toEqual([['t', 'old']]);
  expect(useFeedIgnoreStore.getState().blockOverrides).toEqual({});
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

it('dates a replacement mute list now, or one second past a base dated ahead of this clock', async () => {
  const now = Math.floor(Date.now() / 1000);
  const older = setup([event({ created_at: 10 })]);
  await setPersonBlocked(older.ndk, own, target, true);
  const first = (mockPublish.mock.calls[0][0] as { event: Record<string, unknown> }).event;
  expect(first).toMatchObject({ kind: 10000, pubkey: own });
  expect(first.created_at).toBeGreaterThanOrEqual(now);
  expect(first.created_at).toBeLessThan(now + 5);

  useFeedIgnoreStore.setState(useFeedIgnoreStore.getInitialState(), true);
  const ahead = setup([event({ created_at: now + 30 })]);
  await setPersonBlocked(ahead.ndk, own, target, true);
  const second = (mockPublish.mock.calls[1][0] as { event: Record<string, unknown> }).event;
  expect(second.created_at).toBe(now + 31);
});

it('refuses a mute list whose signer was replaced before signing, after asking the old signer', async () => {
  const { NDKEvent } = jest.requireMock('@nostr-dev-kit/ndk-mobile');
  const sign = jest.spyOn(NDKEvent.prototype, 'sign');
  const { ndk, signer } = setup();
  signer.encrypt.mockImplementationOnce(async (_user, content) => {
    (ndk as unknown as { signer: unknown }).signer = { ...signer };
    return content;
  });
  await expect(setPersonBlocked(ndk, own, target, true)).rejects.toThrow('Account signer changed');
  // Checked before signing, as for the follow list: the replaced signer is never asked.
  expect(sign).not.toHaveBeenCalled();
  expect(mockPublish).not.toHaveBeenCalled();
  sign.mockRestore();
});

it('publishes a report as a kind 1984 with empty content, and refuses one whose signer changed while signing', async () => {
  const ok = setup();
  await publishReport(ok.ndk, own, target, 'spam');
  expect(mockPublish).toHaveBeenCalledTimes(1);
  const published = (mockPublish.mock.calls[0][0] as { event: Record<string, unknown> }).event;
  expect(published).toMatchObject({ kind: 1984, pubkey: own, content: '' });
  expect(published.tags).toEqual([['p', target, 'spam']]);

  const { ndk, signer } = setup();
  signer.user
    .mockImplementationOnce(async () => ({ pubkey: own }))
    .mockImplementationOnce(async () => {
      (ndk as unknown as { signer: unknown }).signer = { ...signer };
      return { pubkey: own };
    });
  await expect(publishReport(ndk, own, target, 'spam')).rejects.toThrow('Account signer changed');
  expect(mockPublish).toHaveBeenCalledTimes(1);
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

describe('where a block is sent', () => {
  it('sends it only to the relays the read asked, never one added after it', async () => {
    const { ndk, signer } = setup();
    const added = { url: 'wss://added.example' };
    signer.encrypt.mockImplementationOnce(async (_user, content) => {
      mockRelays.push(added);
      return content;
    });
    await setPersonBlocked(ndk, own, target, true);
    expect((mockPublish.mock.calls[0][0] as { relays: string[] }).relays).toEqual([mockRelay.url]);
  });

  it("waits, blocked on this device, until this session has found the account's relays", async () => {
    mockDiscovered = false;
    const { ndk, subscription } = setup();
    await expect(setPersonBlocked(ndk, own, target, true)).rejects.toThrow(
      'Mute-list relays not known yet'
    );
    expect(subscription.start).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
    expect(useFeedIgnoreStore.getState().ignoredPubkeys).toEqual([target]);
    expect(useFeedIgnoreStore.getState().blockOverrides).toEqual({ [target]: true });
  });
});
