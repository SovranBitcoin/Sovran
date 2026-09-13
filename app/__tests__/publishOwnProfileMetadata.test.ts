import { EventEmitter } from 'node:events';
import { nostrLog } from '@/shared/lib/logger';
import type { PublishResult, PublishError } from '@/shared/lib/nostr/publish/types';
import { errAsync, okAsync, ResultAsync, ok, type Result } from 'neverthrow';
import {
  publishOwnProfileMetadata,
  ingestOwnProfileMetadata,
  loadOwnProfileMetadata,
  PROFILE_CREATED_AT_MAX_SKEW_SECONDS,
  type OwnProfileLoadResult,
} from '@/shared/lib/nostr/profile/publishOwnProfileMetadata';
import { useOwnProfileMetadataStore } from '@/shared/stores/profile/ownProfileMetadataStore';
import { publishEvent } from '@/shared/lib/nostr/publish/publishEvent';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import NDK from '@nostr-dev-kit/ndk-mobile';

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
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: {
    getState: () => ({
      getActiveProfile: () => ({ pubkey: 'a'.repeat(64), accountIndex: 0 }),
      updateProfileMetadata: mockUpdate,
    }),
    subscribe: jest.fn(() => () => {}),
  },
}));
const mockUpdate = jest.fn();
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => ({
    cache: { profiles: { delete: mockDelete }, ingestProfileMetadata: mockIngest },
  }),
}));
const mockIngest = jest.fn();
const mockDelete = jest.fn();
jest.mock('@/shared/lib/nostr/publish/publishEvent', () => ({ publishEvent: jest.fn() }));
jest.mock('@/shared/lib/nostr/outbox/relayListStore', () => ({ getOwnWriteRelays: () => [] }));
jest.mock(
  '@nostr-dev-kit/ndk-mobile',
  () => ({
    __esModule: true,
    default: jest.fn(),
    normalizeRelayUrl: (url: string) => url,
    NDKSubscriptionCacheUsage: { ONLY_RELAY: 'ONLY_RELAY' },
    NDKEvent: class {
      id = 'e'.repeat(64);
      sign = jest.fn(async () => {});
    },
  }),
  { virtual: true }
);

const pubkey = 'a'.repeat(64);
const accepted = {
  eventId: 'e'.repeat(64),
  anyAccepted: true,
  accepted: [{ url: 'wss://relay.example', ok: true as const, durationMs: 1 }],
  failed: [],
  relayResults: [],
};
const makeNdk = () => {
  const relay = { url: 'wss://relay.example/' };
  const subscription = Object.assign(new EventEmitter(), {
    relayFilters: new Map([[relay.url, []]]),
    eosesSeen: new Set<{ url: string }>(),
    stop: jest.fn(),
    start: jest.fn(async () => {
      eose();
    }),
  });
  const eose = () => {
    subscription.eosesSeen.add(relay);
    subscription.emit('eose');
  };
  return Object.assign(new NDK(), {
    signer: { user: async () => ({ pubkey }) },
    subscribe: jest.fn(() => subscription),
    subscription,
    eose,
  });
};
const publish = (ndk: NDK = makeNdk(), initialLoad: OwnProfileLoadResult = { status: 'absent' }) =>
  publishOwnProfileMetadata({
    ndk,
    pubkey,
    accountIndex: 0,
    patch: { name: 'New', picture: null },
    initialLoad,
  });
beforeEach(() => {
  jest.clearAllMocks();
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
  const ndk = new NDK();
  expect((await publish(ndk))._unsafeUnwrapErr()).toEqual({ type: 'no-signer' });
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
  const ndk = makeNdk();
  const first = publish(ndk);
  const second = publish(ndk);
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
  const ndk = makeNdk();
  ndk.subscription.start.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => {
          ndk.eose();
          resolve();
        };
      })
  );
  const result = publish(ndk);
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
  const ndk = makeNdk();
  ndk.subscription.start.mockImplementation(() => new Promise(() => {}));
  const latest = { content: { about: 'keep' }, createdAt: 20, eventId: 'b'.repeat(64) };
  useOwnProfileMetadataStore.getState().setLatest(latest);
  const loading = loadOwnProfileMetadata(ndk, pubkey);
  await jest.advanceTimersByTimeAsync(3000);
  expect(await loading).toEqual({ status: 'found', snapshot: latest });
  expect(ndk.subscription.stop).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

it('preserves the freshest fetched base, including fields unseen by the editor', async () => {
  useOwnProfileMetadataStore
    .getState()
    .setLatest({ content: { about: 'Old' }, createdAt: 10, eventId: 'b'.repeat(64) });
  const ndk = makeNdk();
  ndk.subscription.start.mockImplementation(async () => {
    ndk.subscription.emit('event', {
      pubkey,
      kind: 0,
      id: 'c'.repeat(64),
      created_at: 20,
      content: JSON.stringify({
        about: 'New',
        name: 'handle',
        display_name: 'Old',
        extension: { keep: true },
      }),
    });
    ndk.eose();
  });
  await publish(ndk);
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
  const ndk = new NDK();
  Object.assign(ndk, {
    signer: {
      user: async () => {
        throw new Error('denied');
      },
    },
  });
  expect((await publish(ndk))._unsafeUnwrapErr().type).toBe('sign-failed');
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
  const ndk = makeNdk();
  ndk.subscription.start.mockImplementation(() => new Promise(() => {}));
  const pending = publish(ndk);
  await jest.advanceTimersByTimeAsync(3000);
  const result = await pending;
  spy.mockRestore();
  jest.useRealTimers();
  expect(result.isErr() && result.error.type).toBe('base-unavailable');
  expect(publishEvent).not.toHaveBeenCalled();
  expect(useOwnProfileMetadataStore.getState().optimistic).toBeNull();
});

it('publishes an empty base only after mount and save both receive empty relay EOSE', async () => {
  const ndk = makeNdk();
  const initialLoad = await loadOwnProfileMetadata(ndk, pubkey);
  expect(initialLoad).toEqual({ status: 'absent' });
  expect((await publish(ndk, initialLoad)).isOk()).toBe(true);
  expect(ndk.subscribe).toHaveBeenCalledTimes(2);
  expect(ndk.subscribe).toHaveBeenCalledWith(
    { kinds: [0], authors: [pubkey] },
    { cacheUsage: 'ONLY_RELAY', closeOnEose: false },
    undefined,
    false
  );
  expect(JSON.parse(jest.mocked(publishEvent).mock.calls[0][0].event.content)).toEqual({
    name: 'New',
    display_name: 'New',
  });
});
it('refuses an empty save lookup after an unavailable mount lookup', async () => {
  expect((await publish(makeNdk(), { status: 'unavailable' }))._unsafeUnwrapErr().type).toBe(
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
it.each(['timeout', 'error', 'invalid', 'synthetic-eose', 'partial-eose'])(
  'does not classify %s as no kind-0',
  async (failure) => {
    jest.useFakeTimers();
    const ndk = makeNdk();
    ndk.subscription.start.mockImplementation(async () => {
      if (failure === 'error') throw new Error('offline');
      if (failure === 'invalid') {
        ndk.subscription.emit('event', { pubkey, kind: 0, content: 'not json' });
        ndk.eose();
      }
      if (failure === 'synthetic-eose') ndk.subscription.emit('eose');
      if (failure === 'partial-eose') {
        ndk.subscription.relayFilters.set('wss://other.example/', []);
        ndk.eose();
      }
    });
    const pending = publish(ndk);
    await jest.advanceTimersByTimeAsync(3000);
    const result = await pending;
    jest.useRealTimers();
    expect(result._unsafeUnwrapErr().type).toBe('base-unavailable');
    expect(ndk.subscription.stop).toHaveBeenCalledTimes(1);
    expect(publishEvent).not.toHaveBeenCalled();
  }
);
it('clamps a future base and logs only its delta once per publish', async () => {
  jest.useFakeTimers().setSystemTime(1000000);
  const createdAt = 100000;
  useOwnProfileMetadataStore.getState().setLatest({
    content: { lud16: 'keep', nip05: 'keep', banner: 'keep', about: 'keep', website: 'keep' },
    createdAt,
    eventId: 'b'.repeat(64),
  });
  await publish();
  const event = jest.mocked(publishEvent).mock.calls[0][0].event;
  expect(event.created_at).toBeGreaterThan(1000 + PROFILE_CREATED_AT_MAX_SKEW_SECONDS);
  expect(JSON.parse(event.content)).toMatchObject({
    lud16: 'keep',
    nip05: 'keep',
    banner: 'keep',
    about: 'keep',
    website: 'keep',
  });
  expect(nostrLog.warn).toHaveBeenCalledTimes(1);
  expect(nostrLog.warn).toHaveBeenCalledWith('nostr.profile.publish.clock_skew', {
    deltaSeconds: createdAt - 1000,
  });
  jest.useRealTimers();
});
