import type { RelaySubscriptionHandlers } from 'nostr/client';
import {
  decodeMuteList,
  publishReport,
  setPersonBlocked,
  syncMuteList,
} from '../shared/lib/nostr/moderation';
import { useFeedIgnoreStore } from '../shared/stores/profile/ignoreStore';
import { asNostrPubkeyHex } from '../shared/lib/protocolIds';
import {
  SILENT_READS_BEFORE_LEFT_OUT,
  forgetSilentRelays,
} from '../shared/lib/nostr/ownReplaceableEvent';
import {
  asVerified,
  fakeClient,
  fakeSigned,
  fakeSigner,
  type FakeClient,
} from './helpers/fakeNostrClient';

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

jest.mock('nostr-tools/pure', () =>
  jest.requireActual('./helpers/fakeNostrClient').pureTrustingFakeEvents()
);
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

/**
 * A client whose every relay answers with `events`, then EOSE unless `eose` is
 * false. `listeners` reach the handlers of the latest read.
 */
function setup(events: unknown[] = [], eose = true) {
  let latest: RelaySubscriptionHandlers | undefined;
  const listeners = {
    event: (relayEvent: unknown) => latest?.onEvent(asVerified(relayEvent as object)),
    eose: () => latest?.onEose(),
  };
  const subscription = {
    stop: jest.fn(),
    start: jest.fn((handlers: RelaySubscriptionHandlers) => {
      latest = handlers;
      for (const relayEvent of events) handlers.onEvent(asVerified(relayEvent as object));
      if (eose) handlers.onEose();
    }),
  };
  const signer = fakeSigner(own);
  const client: FakeClient = fakeClient({
    signer,
    subscribeRelay: (_url, _filters, handlers) => {
      void Promise.resolve().then(() => subscription.start(handlers));
      return { stop: subscription.stop };
    },
  });
  return { client, signer, subscription, listeners };
}

function event(overrides: Record<string, unknown> = {}) {
  return asVerified({
    kind: 10000,
    pubkey: own,
    created_at: 10,
    tags: [],
    content: '',
    id: 'c'.repeat(64),
    sig: 'sig',
    ...overrides,
  });
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
  const { client } = setup([
    event({ id: 'f'.repeat(64), tags: [['p', own]] }),
    event({ id: 'd'.repeat(64), content: JSON.stringify([['p', target]]) }),
  ]);
  await syncMuteList(client, own);
  expect(useFeedIgnoreStore.getState().ignoredPubkeys).toEqual([target]);
});

it('does not overwrite encrypted lists if decryption fails', async () => {
  const { client, signer } = setup([event({ content: 'unreadable' })]);
  signer.decrypt.mockImplementationOnce(() => {
    throw new Error('Denied');
  });
  await expect(setPersonBlocked(client, own, target, true)).rejects.toThrow();
  expect(mockPublish).not.toHaveBeenCalled();
  expect(useFeedIgnoreStore.getState().ignoredPubkeys).toEqual([target]);
});

it('times out and stops subscriptions; an empty timed-out read cannot create a list', async () => {
  jest.useFakeTimers();
  const { client, subscription } = setup([], false);
  const result = expect(setPersonBlocked(client, own, target, true)).rejects.toThrow('timed out');
  // The only relay is read again until it counts as silent, and once more:
  // with no other relay there is nothing to read without it.
  await readsTimeOut(SILENT_READS_BEFORE_LEFT_OUT + 1);
  await result;
  expect(subscription.start).toHaveBeenCalledTimes(SILENT_READS_BEFORE_LEFT_OUT + 1);
  expect(subscription.stop).toHaveBeenCalled();
  expect(mockPublish).not.toHaveBeenCalled();
});

it('creates the first encrypted block list without a second confirmation after relay reads finish', async () => {
  const { client } = setup();
  await setPersonBlocked(client, own, target, true);
  expect(mockPublish).toHaveBeenCalledTimes(1);
  expect(useFeedIgnoreStore.getState().blockOverrides).toEqual({});
});

it('keeps a first block local when configured relays have not confirmed an empty list', async () => {
  jest.useFakeTimers();
  // Only another relay answers: this one never confirms the list is empty.
  const { client } = setup([], false);
  const result = expect(setPersonBlocked(client, own, target, true)).rejects.toThrow();
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
  const client = fakeClient({
    signer: fast.signer,
    subscribeRelay: (url, filters, handlers) =>
      (url === slowRelay.url ? slow : fast).client.subscribeRelay(url, filters, handlers),
  });
  return { client, fast, slow, slowRelay };
}

it('waits for the slower relay and preserves its newer private blocks and unfamiliar tags', async () => {
  const { client, fast, slow } = setupDelayedRelay();
  const result = setPersonBlocked(client, own, target, true);
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
  const { client, fast, slow, slowRelay } = setupDelayedRelay();
  const result = setPersonBlocked(client, own, target, true);
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
  const { client, signer } = setup();
  signer.pubkey = target;
  await expect(publishReport(client, own, target, 'spam')).rejects.toThrow('signer');
  expect(mockPublish).not.toHaveBeenCalled();
});

it('ignores reads after switching away and back, while allowing ordinary profile metadata changes', async () => {
  const { client, subscription } = setup([event({ tags: [['p', target]] })]);
  const answer = subscription.start.getMockImplementation()!;
  subscription.start.mockImplementationOnce((handlers) => {
    for (const index of [1, 0]) {
      mockProfile.activeAccountIndex = index;
      for (const listener of mockListeners) listener(mockProfile);
    }
    answer(handlers);
  });
  await expect(syncMuteList(client, own)).rejects.toThrow('Profile changed');
  expect(useFeedIgnoreStore.getState().ignoredPubkeys).toEqual([]);
  subscription.start.mockImplementationOnce((handlers) => {
    mockProfile.profiles = mockProfile.profiles.slice();
    for (const listener of mockListeners) listener(mockProfile);
    answer(handlers);
  });
  await syncMuteList(client, own);
  expect(useFeedIgnoreStore.getState().ignoredPubkeys).toEqual([target]);
});

it('does not overwrite a newer list learned while the signer was open', async () => {
  const { client, signer } = setup([event()]);
  signer.encrypt.mockImplementationOnce((_peer: string, content: string) => {
    useFeedIgnoreStore.getState().receiveMuteList({
      id: 'e'.repeat(64),
      createdAt: 20,
      tags: [['t', 'preserve']],
      privateTags: [],
    });
    return content;
  });
  await expect(setPersonBlocked(client, own, target, true)).rejects.toThrow('Mute list changed');
  expect(mockPublish).not.toHaveBeenCalled();
  expect(useFeedIgnoreStore.getState().blockOverrides[target]).toBe(true);
});

it('dates a replacement mute list now, or one second past a base dated ahead of this clock', async () => {
  const now = Math.floor(Date.now() / 1000);
  const older = setup([event({ created_at: 10 })]);
  await setPersonBlocked(older.client, own, target, true);
  const first = (mockPublish.mock.calls[0][0] as { event: Record<string, unknown> }).event;
  expect(first).toMatchObject({ kind: 10000, pubkey: own });
  expect(first.created_at).toBeGreaterThanOrEqual(now);
  expect(first.created_at).toBeLessThan(now + 5);

  useFeedIgnoreStore.setState(useFeedIgnoreStore.getInitialState(), true);
  const ahead = setup([event({ created_at: now + 30 })]);
  await setPersonBlocked(ahead.client, own, target, true);
  const second = (mockPublish.mock.calls[1][0] as { event: Record<string, unknown> }).event;
  expect(second.created_at).toBe(now + 31);
});

it('refuses a mute list whose signer was replaced before signing, after asking the old signer', async () => {
  const { client, signer } = setup();
  const replacement = fakeSigner(own);
  signer.encrypt.mockImplementationOnce((_peer: string, content: string) => {
    client.signer = replacement;
    return content;
  });
  await expect(setPersonBlocked(client, own, target, true)).rejects.toThrow(
    'Account signer changed'
  );
  // Checked before signing, as for the follow list: the replaced signer is never asked.
  expect(signer.sign).not.toHaveBeenCalled();
  expect(replacement.sign).not.toHaveBeenCalled();
  expect(mockPublish).not.toHaveBeenCalled();
});

it('publishes a report as a kind 1984 with empty content, and refuses one whose signer changed while signing', async () => {
  const ok = setup();
  await publishReport(ok.client, own, target, 'spam');
  expect(mockPublish).toHaveBeenCalledTimes(1);
  const published = (mockPublish.mock.calls[0][0] as { event: Record<string, unknown> }).event;
  expect(published).toMatchObject({ kind: 1984, pubkey: own, content: '' });
  expect(published.tags).toEqual([['p', target, 'spam']]);

  const { client, signer } = setup();
  signer.sign.mockImplementationOnce((template) => {
    client.signer = fakeSigner(own);
    return fakeSigned(template, own);
  });
  await expect(publishReport(client, own, target, 'spam')).rejects.toThrow(
    'Account signer changed'
  );
  expect(mockPublish).toHaveBeenCalledTimes(1);
});

it('rejects invalid IDs, timestamps and signatures before parsing a list', async () => {
  const { client } = setup();
  for (const bad of [
    event({ created_at: -1 }),
    event({ created_at: 1.5 }),
    event({ hash: 'different' }),
    event({ sig: 'invalid' }),
  ]) {
    await expect(decodeMuteList(client, bad, own)).rejects.toThrow('Invalid mute list');
  }
});

it('never falls back to an older list when the newest authenticated list is unsupported', async () => {
  for (const newest of [
    event({ created_at: 20, content: 'x'.repeat(1_000_001) }),
    event({ created_at: Math.floor(Date.now() / 1000) + 3600 }),
  ]) {
    const { client } = setup([event(), newest]);
    await expect(setPersonBlocked(client, own, target, true)).rejects.toThrow(
      'Unsupported mute list'
    );
    expect(mockPublish).not.toHaveBeenCalled();
  }
});

describe('where a block is sent', () => {
  it('sends it only to the relays the read asked, never one added after it', async () => {
    const { client, signer } = setup();
    const added = { url: 'wss://added.example' };
    signer.encrypt.mockImplementationOnce((_peer: string, content: string) => {
      mockRelays.push(added);
      return content;
    });
    await setPersonBlocked(client, own, target, true);
    expect((mockPublish.mock.calls[0][0] as { relays: string[] }).relays).toEqual([mockRelay.url]);
  });

  it("waits, blocked on this device, until this session has found the account's relays", async () => {
    mockDiscovered = false;
    const { client, subscription } = setup();
    await expect(setPersonBlocked(client, own, target, true)).rejects.toThrow(
      'Mute-list relays not known yet'
    );
    expect(subscription.start).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
    expect(useFeedIgnoreStore.getState().ignoredPubkeys).toEqual([target]);
    expect(useFeedIgnoreStore.getState().blockOverrides).toEqual({ [target]: true });
  });
});
