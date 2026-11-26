import { verifyNip05 } from 'wallet';
import { nostrLog } from '@/shared/lib/logger';
import type { PublishResult, PublishError } from '@/shared/lib/nostr/publish/types';
import { errAsync, okAsync, ResultAsync, ok, type Result } from 'neverthrow';
import {
  publishOwnProfileMetadata,
  ingestOwnProfileMetadata,
  loadOwnProfileMetadata,
  type OwnProfileLoadResult,
} from '@/shared/lib/nostr/profile/publishOwnProfileMetadata';
import {
  MAX_FUTURE_SEC,
  SILENT_READS_BEFORE_LEFT_OUT,
  forgetSilentRelays,
  readNewestOwnEvent,
} from '@/shared/lib/nostr/ownReplaceableEvent';
import { useOwnProfileMetadataStore } from '@/shared/stores/profile/ownProfileMetadataStore';
import { publishEvent } from '@/shared/lib/nostr/publish/publishEvent';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import type { RelaySubscriptionHandlers, UnsignedNostrEvent } from 'nostr/client';
import { fakeClient, fakeSigned, fakeSigner, type FakeClient } from './helpers/fakeNostrClient';

jest.mock('wallet', () => ({ ...jest.requireActual('wallet'), verifyNip05: jest.fn() }));

jest.mock('@/shared/lib/logger', () => ({
  nostrLog: { info: jest.fn(), warn: jest.fn() },
  storeLog: { warn: jest.fn() },
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  withSkippedPersistWrites: (fn: () => void) => fn(),
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/stores/global/profileStore', () => {
  const useProfileStore = {
    getState: () => ({
      getActiveProfile: () => ({ pubkey: 'a'.repeat(64), accountIndex: 0 }),
      updateProfileMetadata: mockUpdate,
    }),
    subscribe: jest.fn(() => () => {}),
  };
  return {
    useProfileStore,
    ...jest
      .requireActual<typeof import('./helpers/profileStoreMock')>('./helpers/profileStoreMock')
      .activeAccountReaders(() => useProfileStore.getState()),
  };
});
const mockUpdate = jest.fn();
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => ({
    cache: { profiles: { delete: mockDelete }, ingestProfileMetadata: mockIngest },
  }),
}));
const mockIngest = jest.fn();
const mockDelete = jest.fn();
jest.mock('@/shared/lib/nostr/publish/publishEvent', () => ({ publishEvent: jest.fn() }));
/** The account's write relays this session's relay-list sync found, or null before it has. */
let mockKnown: string[] | null;
jest.mock('@/shared/lib/nostr/outbox/relayListStore', () => ({
  getOwnWriteRelays: () => [],
  getKnownOwnWriteRelays: () => mockKnown,
}));
const mockSign = jest.fn(async (..._args: unknown[]) => {});
jest.mock('nostr-tools/pure', () =>
  jest.requireActual('./helpers/fakeNostrClient').pureTrustingFakeEvents()
);

const pubkey = 'a'.repeat(64);
const RELAY = 'wss://relay.example/';
/** A signed kind 0 as a relay sends it. */
const kind0 = (id: string, created_at: number, content: unknown) => ({
  pubkey,
  kind: 0,
  id,
  created_at,
  content: typeof content === 'string' ? content : JSON.stringify(content),
  sig: 'sig',
});
const accepted = {
  eventId: 'e'.repeat(64),
  anyAccepted: true,
  accepted: [{ url: 'wss://relay.example', ok: true as const, durationMs: 1 }],
  failed: [],
  relayResults: [],
};
/** One read of one relay. */
type FakeSubscription = {
  url: string;
  stop: jest.Mock;
  /** The relay sends an event, or a bare EOSE. */
  emit: (type: 'event' | 'eose', event?: unknown) => void;
  /** The relay has sent everything it holds. */
  eose: () => void;
};
/** The account's signer; each event it signs is told to `mockSign` first. */
const ownSigner = () => {
  const signer = fakeSigner(pubkey);
  signer.sign.mockImplementation((template: UnsignedNostrEvent) => {
    void mockSign(template);
    return fakeSigned(template, pubkey);
  });
  return signer;
};
/**
 * A client whose pool is `RELAY` and whose every read is its own, so each
 * relay answers, or stays silent, on its own. What a relay does when a read of
 * it starts is `onStart`; by default it answers holding nothing. A start that
 * rejects is a socket that dropped.
 */
const makeClient = (signer: unknown = ownSigner()) => {
  const subscriptions: FakeSubscription[] = [];
  const onStart = jest.fn(async (subscription: FakeSubscription) => subscription.eose());
  const subscribeRelay = jest.fn(
    (url: string, _filters: unknown, handlers: RelaySubscriptionHandlers) => {
      const subscription: FakeSubscription = {
        url,
        stop: jest.fn(),
        emit: (type, event) =>
          type === 'event' ? handlers.onEvent(event as never) : handlers.onEose(),
        eose: () => handlers.onEose(),
      };
      subscriptions.push(subscription);
      void Promise.resolve()
        .then(() => onStart(subscription))
        .catch((error: Error) => handlers.onError?.(error));
      return { stop: subscription.stop };
    }
  );
  const client: FakeClient = fakeClient({ signer, relays: [RELAY], subscribeRelay });
  return Object.assign(client, { subscribeRelay, subscriptions, onStart });
};
const publish = (
  client: FakeClient = makeClient(),
  initialLoad: OwnProfileLoadResult = { status: 'absent' }
) =>
  publishOwnProfileMetadata({
    client,
    pubkey,
    accountIndex: 0,
    patch: { name: 'New', picture: null },
    initialLoad,
  });
/** Let `reads` reads end, each by a relay's silence (12 s). */
async function readsTimeOut(reads: number) {
  for (let read = 0; read < reads; read++) await jest.advanceTimersByTimeAsync(12_001);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSign.mockReset().mockResolvedValue(undefined);
  forgetSilentRelays();
  mockKnown = [RELAY];
  useOwnProfileMetadataStore.setState({ latest: null, optimistic: null });
  jest.mocked(publishEvent).mockReturnValue(okAsync(accepted));
});

it('acceptance updates profile and cache, removes the old avatar, and clears the overlay', async () => {
  const result = await publish();
  expect(result.isOk()).toBe(true);
  expect(mockUpdate).toHaveBeenCalledWith(0, 'New', undefined);
  expect(mockDelete).toHaveBeenCalledWith(pubkey);
  expect(mockIngest).toHaveBeenCalledWith(
    { [pubkey]: expect.objectContaining({ displayName: 'New' }) },
    expect.any(Number),
    'relay'
  );
  expect(useOwnProfileMetadataStore.getState().optimistic).toBeNull();
  expect(useOwnProfileMetadataStore.getState().latest?.content).toEqual({
    display_name: 'New',
    name: 'New',
  });
  expect(jest.mocked(publishEvent).mock.calls[0][0].resolveOn).toBe('optimistic');
  expect(jest.mocked(publishEvent).mock.calls[0][0].relays).toEqual([RELAY]);
});
it('all-failed rolls back the overlay without a profile or cache write', async () => {
  jest.mocked(publishEvent).mockImplementation(() => {
    expect(useOwnProfileMetadataStore.getState().optimistic?.name).toBe('New');
    return errAsync({ type: 'all-failed', relayResults: [] });
  });
  expect((await publish()).isErr()).toBe(true);
  expect(useOwnProfileMetadataStore.getState().optimistic).toBeNull();
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockIngest).not.toHaveBeenCalled();
  expect(mockDelete).not.toHaveBeenCalled();
});
it('no signer returns a typed error without an overlay', async () => {
  const client = makeClient(null);
  expect((await publish(client))._unsafeUnwrapErr()).toEqual({ type: 'no-signer' });
  expect(publishEvent).not.toHaveBeenCalled();
  expect(useOwnProfileMetadataStore.getState().optimistic).toBeNull();
});
it('duplicate saves join the same operation and publish only once', async () => {
  let finish!: (result: Result<PublishResult, PublishError>) => void;
  jest.mocked(publishEvent).mockReturnValue(
    new ResultAsync(
      new Promise((resolve) => {
        finish = resolve;
      })
    )
  );
  const client = makeClient();
  const first = publish(client);
  const second = publish(client);
  expect(first).toBe(second);
  for (let i = 0; i < 20 && !finish; i++) await Promise.resolve();
  // Allow the bounded base lookup and signing to reach the publish seam.
  await new Promise((resolve) => setTimeout(resolve, 0));
  finish(ok(accepted));
  await first;
  expect(publishEvent).toHaveBeenCalledTimes(1);
});
it('a same-id relay echo is idempotent and an older echo cannot regress the profile', async () => {
  await publish();
  const snapshot = useOwnProfileMetadataStore.getState().latest!;
  mockUpdate.mockClear();
  mockIngest.mockClear();
  ingestOwnProfileMetadata(snapshot, pubkey, 0);
  ingestOwnProfileMetadata(
    { ...snapshot, eventId: 'f'.repeat(64), createdAt: snapshot.createdAt - 1 },
    pubkey,
    0
  );
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockIngest).not.toHaveBeenCalled();
});
it('a profile switch during the base lookup prevents publishing', async () => {
  let finish!: () => void;
  const client = makeClient();
  client.onStart.mockImplementation(
    (subscription) =>
      new Promise((resolve) => {
        finish = () => {
          subscription.eose();
          resolve();
        };
      })
  );
  const result = publish(client);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const listener = jest.mocked(useProfileStore.subscribe).mock.calls.at(-1)![0];
  const spy = jest
    .spyOn(useProfileStore, 'getState')
    .mockReturnValue({ ...useProfileStore.getState(), getActiveProfile: () => undefined });
  listener(useProfileStore.getState(), useProfileStore.getState());
  finish();
  expect((await result)._unsafeUnwrapErr().type).toBe('profile-changed');
  spy.mockRestore();
  expect(publishEvent).not.toHaveBeenCalled();
});
it('a stalled base fetch settles at three seconds and retains the local snapshot', async () => {
  jest.useFakeTimers();
  const client = makeClient();
  client.onStart.mockImplementation(() => new Promise(() => {}));
  const latest = { content: { about: 'keep' }, createdAt: 20, eventId: 'b'.repeat(64) };
  useOwnProfileMetadataStore.getState().setLatest(latest);
  const loading = loadOwnProfileMetadata(client, pubkey);
  await jest.advanceTimersByTimeAsync(3000);
  expect(await loading).toEqual({ status: 'found', snapshot: latest });
  expect(client.subscriptions).toHaveLength(1);
  expect(client.subscriptions[0].stop).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

it('preserves the freshest fetched base, including fields unseen by the editor', async () => {
  useOwnProfileMetadataStore
    .getState()
    .setLatest({ content: { about: 'Old' }, createdAt: 10, eventId: 'b'.repeat(64) });
  const client = makeClient();
  client.onStart.mockImplementation(async (subscription) => {
    subscription.emit(
      'event',
      kind0('c'.repeat(64), 20, {
        about: 'New',
        name: 'handle',
        display_name: 'Old',
        extension: { keep: true },
      })
    );
    subscription.eose();
  });
  await publish(client);
  const event = jest.mocked(publishEvent).mock.calls[0][0].event;
  expect(JSON.parse(event.content)).toEqual({
    name: 'handle',
    display_name: 'New',
    about: 'New',
    extension: { keep: true },
  });
  expect(event.created_at).toBeGreaterThan(20);
});
it('signer rejection does not publish or leave an overlay', async () => {
  const signer = fakeSigner(pubkey);
  signer.sign.mockImplementation(() => {
    throw new Error('denied');
  });
  expect((await publish(makeClient(signer)))._unsafeUnwrapErr().type).toBe('sign-failed');
  expect(useOwnProfileMetadataStore.getState().optimistic).toBeNull();
  expect(publishEvent).not.toHaveBeenCalled();
});
it('a profile switch while publishing clears optimism and ignores late acceptance', async () => {
  let finish!: (value: Result<PublishResult, PublishError>) => void;
  jest.mocked(publishEvent).mockReturnValue(
    new ResultAsync(
      new Promise((resolve) => {
        finish = resolve;
      })
    )
  );
  const result = publish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(useOwnProfileMetadataStore.getState().optimistic).not.toBeNull();
  const listener = jest.mocked(useProfileStore.subscribe).mock.calls.at(-1)![0];
  const spy = jest
    .spyOn(useProfileStore, 'getState')
    .mockReturnValue({ ...useProfileStore.getState(), getActiveProfile: () => undefined });
  listener(useProfileStore.getState(), useProfileStore.getState());
  expect(useOwnProfileMetadataStore.getState().optimistic).toBeNull();
  finish(ok(accepted));
  await result;
  spy.mockRestore();
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockIngest).not.toHaveBeenCalled();
});

it('refuses a timed-out base lookup when a cached name proves a profile exists', async () => {
  jest.useFakeTimers();
  const spy = jest.spyOn(useProfileStore, 'getState').mockReturnValue({
    ...useProfileStore.getState(),
    getActiveProfile: () => ({
      pubkey,
      accountIndex: 0,
      addedAt: 0,
      cachedDisplayName: 'Existing',
    }),
  });
  const client = makeClient();
  client.onStart.mockImplementation(() => new Promise(() => {}));
  const pending = publish(client);
  // The only relay is read again until it counts as silent, and once more.
  await readsTimeOut(SILENT_READS_BEFORE_LEFT_OUT + 1);
  const result = await pending;
  spy.mockRestore();
  jest.useRealTimers();
  expect(result.isErr() && result.error.type).toBe('base-unavailable');
  expect(publishEvent).not.toHaveBeenCalled();
  expect(useOwnProfileMetadataStore.getState().optimistic).toBeNull();
});

it('publishes an empty base only after mount and save both receive empty relay EOSE', async () => {
  const client = makeClient();
  const initialLoad = await loadOwnProfileMetadata(client, pubkey);
  expect(initialLoad).toEqual({ status: 'absent' });
  expect((await publish(client, initialLoad)).isOk()).toBe(true);
  expect(client.subscribeRelay).toHaveBeenCalledTimes(2);
  // The editor's fields come from the pool; the save reads each write relay.
  expect(client.subscribeRelay).toHaveBeenNthCalledWith(
    1,
    RELAY,
    [{ kinds: [0], authors: [pubkey] }],
    expect.anything()
  );
  expect(client.subscribeRelay).toHaveBeenNthCalledWith(
    2,
    RELAY,
    [{ kinds: [0], authors: [pubkey] }],
    expect.anything()
  );
  expect(JSON.parse(jest.mocked(publishEvent).mock.calls[0][0].event.content)).toEqual({
    name: 'New',
    display_name: 'New',
  });
});
it('refuses an empty save lookup after an unavailable mount lookup', async () => {
  expect((await publish(makeClient(), { status: 'unavailable' }))._unsafeUnwrapErr().type).toBe(
    'base-unavailable'
  );
  expect(publishEvent).not.toHaveBeenCalled();
});
it.each(['cachedDisplayName', 'cachedPicture'] as const)(
  'refuses two empty lookups when %s is cached',
  async (field) => {
    const spy = jest.spyOn(useProfileStore, 'getState').mockReturnValue({
      ...useProfileStore.getState(),
      getActiveProfile: () => ({ pubkey, accountIndex: 0, addedAt: 0, [field]: 'existing' }),
    });
    const result = await publish();
    spy.mockRestore();
    expect(result._unsafeUnwrapErr().type).toBe('base-unavailable');
    expect(publishEvent).not.toHaveBeenCalled();
  }
);
// Each read is of one relay, so an EOSE always is that relay's own.
it.each(['timeout', 'error', 'invalid'])('does not classify %s as no kind-0', async (failure) => {
  jest.useFakeTimers();
  const client = makeClient();
  client.onStart.mockImplementation(async (subscription) => {
    if (failure === 'error') throw new Error('offline');
    if (failure === 'invalid') {
      subscription.emit('event', kind0('c'.repeat(64), 20, 'not json'));
      subscription.eose();
    }
  });
  const pending = publish(client);
  await readsTimeOut(SILENT_READS_BEFORE_LEFT_OUT + 1);
  const result = await pending;
  jest.useRealTimers();
  expect(result._unsafeUnwrapErr().type).toBe('base-unavailable');
  expect(client.subscriptions.length).toBeGreaterThan(0);
  for (const subscription of client.subscriptions) expect(subscription.stop).toHaveBeenCalled();
  expect(publishEvent).not.toHaveBeenCalled();
});

it('waits for the relay list before reading or saving', async () => {
  mockKnown = null;
  const client = makeClient();
  expect((await publish(client))._unsafeUnwrapErr().type).toBe('base-unavailable');
  expect(client.subscribeRelay).not.toHaveBeenCalled();
  expect(publishEvent).not.toHaveBeenCalled();
});
it('clamps a future base and logs only its delta once per publish', async () => {
  jest.useFakeTimers().setSystemTime(1000000);
  const createdAtSec = 100000;
  useOwnProfileMetadataStore.getState().setLatest({
    content: { lud16: 'keep', nip05: 'keep', banner: 'keep', about: 'keep', website: 'keep' },
    createdAt: createdAtSec,
    eventId: 'b'.repeat(64),
  });
  await publish();
  const event = jest.mocked(publishEvent).mock.calls[0][0].event;
  expect(event.created_at).toBeGreaterThan(1000 + MAX_FUTURE_SEC);
  expect(JSON.parse(event.content)).toMatchObject({
    lud16: 'keep',
    nip05: 'keep',
    banner: 'keep',
    about: 'keep',
    website: 'keep',
  });
  expect(nostrLog.warn).toHaveBeenCalledTimes(1);
  expect(nostrLog.warn).toHaveBeenCalledWith('nostr.profile.publish.clock_skew', {
    deltaSeconds: createdAtSec - 1000,
  });
  jest.useRealTimers();
});

it('of two profiles from the same second, takes the one with the lower id, remote or saved', async () => {
  const emitting = (...events: { id: string; about: string }[]) => {
    const client = makeClient();
    client.onStart.mockImplementation(async (subscription) => {
      for (const { id, about } of events)
        subscription.emit('event', {
          pubkey,
          kind: 0,
          id,
          created_at: 20,
          content: JSON.stringify({ about }),
        });
      subscription.eose();
    });
    return client;
  };
  const low = 'c'.repeat(64);
  const high = 'd'.repeat(64);
  const remote = await loadOwnProfileMetadata(
    emitting({ id: high, about: 'high' }, { id: low, about: 'low' }),
    pubkey
  );
  expect(remote).toMatchObject({ status: 'found', snapshot: { eventId: low } });

  useOwnProfileMetadataStore
    .getState()
    .setLatest({ content: { about: 'saved' }, createdAt: 20, eventId: 'b'.repeat(64) });
  const saved = await loadOwnProfileMetadata(emitting({ id: low, about: 'low' }), pubkey);
  expect(saved).toMatchObject({ status: 'found', snapshot: { eventId: 'b'.repeat(64) } });

  useOwnProfileMetadataStore
    .getState()
    .setLatest({ content: { about: 'saved' }, createdAt: 20, eventId: high });
  const remoteWins = await loadOwnProfileMetadata(emitting({ id: low, about: 'low' }), pubkey);
  expect(remoteWins).toMatchObject({ status: 'found', snapshot: { eventId: low } });
});

it('refuses a changed identity before publishing when the domain does not match', async () => {
  jest
    .mocked(verifyNip05)
    .mockResolvedValue({ status: 'mismatch', identifier: 'alice@example.com' });
  const result = await publishOwnProfileMetadata({
    client: makeClient(),
    pubkey,
    accountIndex: 0,
    patch: { nip05: 'alice@example.com' },
    initialLoad: { status: 'absent' },
  });
  expect(result.isErr() && result.error.type).toBe('nip05-unverified');
  expect(publishEvent).not.toHaveBeenCalled();
  expect(useOwnProfileMetadataStore.getState().optimistic).toBeNull();
});

it('publishes only a freshly verified identity for the signing key', async () => {
  jest
    .mocked(verifyNip05)
    .mockResolvedValue({ status: 'verified', identifier: 'alice@example.com' });
  const result = await publishOwnProfileMetadata({
    client: makeClient(),
    pubkey,
    accountIndex: 0,
    patch: { nip05: 'Alice@Example.com' },
    initialLoad: { status: 'absent' },
  });
  expect(result.isOk()).toBe(true);
  expect(verifyNip05).toHaveBeenCalledWith('Alice@Example.com', pubkey);
  expect(useOwnProfileMetadataStore.getState().latest?.content.nip05).toBe('alice@example.com');
});

it('allows removing an identity without network verification', async () => {
  const result = await publishOwnProfileMetadata({
    client: makeClient(),
    pubkey,
    accountIndex: 0,
    patch: { nip05: null },
    initialLoad: { status: 'absent' },
  });
  expect(result.isOk()).toBe(true);
  expect(verifyNip05).not.toHaveBeenCalled();
  expect(useOwnProfileMetadataStore.getState().latest?.content).not.toHaveProperty('nip05');
});

describe('the profile a save builds on, and where it is sent', () => {
  it('does not build on an older profile one relay sent while another has not answered', async () => {
    jest.useFakeTimers();
    const TWO = 'wss://two.example/';
    mockKnown = [RELAY, TWO];
    const client = makeClient();
    client.onStart.mockImplementation(async (subscription) => {
      // Relay two holds the newer profile and never answers.
      if (subscription.url !== RELAY) return;
      subscription.emit('event', kind0('c'.repeat(64), 20, { name: 'Old' }));
      subscription.eose();
    });
    const pending = publish(client);
    await readsTimeOut(SILENT_READS_BEFORE_LEFT_OUT - 1);
    expect(publishEvent).not.toHaveBeenCalled();

    // Silent three reads in a row: the save goes on without relay two, and is
    // not sent to it. A newer profile only relay two holds is overruled, the
    // risk the owner accepted (F227).
    await readsTimeOut(1);
    const result = await pending;
    jest.useRealTimers();
    expect(result.isOk()).toBe(true);
    const { event, relays } = jest.mocked(publishEvent).mock.calls[0][0];
    expect(JSON.parse(event.content)).toEqual({ name: 'Old', display_name: 'New' });
    expect(relays).toEqual([RELAY]);
  });

  it('builds on the profile the editor opened on when it is newer than what the relays read hold', async () => {
    const opened = { content: { about: 'opened' }, createdAt: 30, eventId: 'd'.repeat(64) };
    const client = makeClient();
    client.onStart.mockImplementation(async (subscription) => {
      subscription.emit('event', kind0('c'.repeat(64), 20, { about: 'older' }));
      subscription.eose();
    });
    await publish(client, { status: 'found', snapshot: opened });
    const { event } = jest.mocked(publishEvent).mock.calls[0][0];
    expect(JSON.parse(event.content)).toMatchObject({ about: 'opened' });
    expect(event.created_at).toBeGreaterThan(30);
  });
});

describe('silence accounting at a fixed clock', () => {
  it('does not exclude a relay after overlapping same-clock failures', async () => {
    jest.useFakeTimers();
    const client = makeClient();
    client.onStart.mockRejectedValue(new Error('offline'));
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
    await Promise.all(
      Array.from({ length: 3 }, () => readNewestOwnEvent(client, pubkey, 0, { relays: [RELAY] }))
    );
    client.onStart.mockImplementation(async (subscription) => {
      if (subscription.url !== RELAY) subscription.eose();
    });
    const reading = readNewestOwnEvent(client, pubkey, 0, {
      relays: [RELAY, 'wss://healthy.example/'],
      leaveOutSilent: true,
    });
    await jest.advanceTimersByTimeAsync(12_000);
    expect((await reading).outcome).toBe('timed-out');
    clock.mockRestore();
    jest.useRealTimers();
  });
});

it('excludes after sequential same-clock failures and restores on a late answer', async () => {
  jest.useFakeTimers();
  const client = makeClient();
  client.onStart.mockRejectedValue(new Error('offline'));
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
  for (let i = 0; i < 3; i++) await readNewestOwnEvent(client, pubkey, 0, { relays: [RELAY] });
  client.onStart.mockImplementation(async (subscription) => {
    if (subscription.url !== RELAY) subscription.eose();
  });
  const relays = [RELAY, 'wss://healthy.example/'];
  const read = await readNewestOwnEvent(client, pubkey, 0, { relays, leaveOutSilent: true });
  expect(read).toMatchObject({ outcome: 'complete', relays: ['wss://healthy.example/'] });
  // The excluded probe answers after the read returned. Next read must wait for it.
  client.subscriptions.at(-2)!.eose();
  const next = readNewestOwnEvent(client, pubkey, 0, { relays, leaveOutSilent: true });
  await jest.advanceTimersByTimeAsync(12_000);
  expect((await next).outcome).toBe('timed-out');
  clock.mockRestore();
  jest.useRealTimers();
});

it('returns waiting after bounded alternating relay timeouts without publishing a partial base', async () => {
  jest.useFakeTimers();
  mockKnown = [RELAY, 'wss://alternating.example/'];
  const client = makeClient();
  let attempt = 0;
  client.onStart.mockImplementation(async (subscription) => {
    if (subscription.url === RELAY) attempt++;
    if ((attempt % 2 === 0) === (subscription.url === RELAY)) subscription.eose();
    else subscription.emit('event', kind0('c'.repeat(64), 20, { about: 'partial' }));
  });
  let settled = false;
  const pending = publish(client);
  void pending.then(() => {
    settled = true;
  });
  await jest.advanceTimersByTimeAsync(48_001);
  const bounded = settled;
  // Always drain the pre-fix worker too, so a red assertion leaves no flight behind.
  client.onStart.mockImplementation(async (subscription) => subscription.eose());
  await jest.advanceTimersByTimeAsync(12_001);
  const result = await pending;
  jest.useRealTimers();
  expect(bounded).toBe(true);
  expect(result._unsafeUnwrapErr().type).toBe('base-unavailable');
  expect(publishEvent).not.toHaveBeenCalled();
});

it.each(['identity verification', 'signing'])(
  'waits if a newer profile arrives during %s, then retries on that profile',
  async (phase) => {
    const before = { content: { about: 'Old' }, createdAt: 20, eventId: 'c'.repeat(64) };
    const newer = { content: { about: 'Newest' }, createdAt: 21, eventId: 'b'.repeat(64) };
    useOwnProfileMetadataStore.getState().setLatest(before);
    const client = makeClient();
    const update = () => useOwnProfileMetadataStore.getState().setLatest(newer);
    jest.mocked(verifyNip05).mockImplementation(async () => {
      if (phase === 'identity verification') update();
      return { status: 'verified', identifier: 'alice@example.com' };
    });
    mockSign.mockImplementationOnce(async () => {
      if (phase === 'signing') update();
    });
    const save = () =>
      publishOwnProfileMetadata({
        client,
        pubkey,
        accountIndex: 0,
        patch: { name: 'New', nip05: 'alice@example.com' },
        initialLoad: { status: 'found', snapshot: before },
      });
    const result = await save();
    expect(publishEvent).not.toHaveBeenCalled();
    expect(result._unsafeUnwrapErr().type).toBe('base-unavailable');
    expect(useOwnProfileMetadataStore.getState().optimistic).toBeNull();
    jest
      .mocked(verifyNip05)
      .mockResolvedValue({ status: 'verified', identifier: 'alice@example.com' });
    expect((await save()).isOk()).toBe(true);
    const { event } = jest.mocked(publishEvent).mock.calls[0][0];
    expect(JSON.parse(event.content)).toMatchObject({ about: 'Newest', name: 'New' });
    expect(event.created_at).toBeGreaterThan(newer.createdAt);
  }
);

it('does not commit profile success after its signer was replaced during publish', async () => {
  const client = makeClient();
  jest.mocked(publishEvent).mockImplementation(() => {
    client.signer = ownSigner();
    return okAsync(accepted);
  });
  expect((await publish(client))._unsafeUnwrapErr().type).toBe('profile-changed');
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(useOwnProfileMetadataStore.getState().latest).toBeNull();
});
