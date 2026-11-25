/**
 * @jest-environment node
 *
 * `useOwnRelayListSync`: once the account's Nostr client is ready it reads the account's own NIP-65
 * relay list (kind:10002) and either takes it into the real relay-list store
 * and the relay pool, or, when the network has none, publishes the default
 * relays once. Pinned: which relays it asks, what counts as an answer, what it
 * writes where, the last-writer rule (equal timestamps included), and what an
 * unmount or account change does to a sync in flight.
 *
 * Replaced: the relays (`mockRelays`: per relay, the events it holds, or
 * silence, or a failure; a relay not listed holds nothing and answers), the
 * publish seam, the pool seeding, storage, AppState and the offline status.
 * Each read asks one relay, which reports end-of-stored for itself.
 */
import { act, renderHook } from '@testing-library/react-native';
import { ResultAsync, errAsync, okAsync } from 'neverthrow';

import { beginRelayListEdit } from '@/shared/lib/nostr/outbox/publishOwnRelayList';
import type { RelaySubscriptionHandlers } from 'nostr/client';
import { fakeClient, fakeSigner, type FakeClient } from './helpers/fakeNostrClient';
import { useOwnRelayListSync } from '@/shared/lib/nostr/outbox/useOwnRelayListSync';
import {
  getKnownOwnWriteRelays,
  useRelayListStore,
} from '@/shared/lib/nostr/outbox/relayListStore';
import {
  DEFAULT_RELAYS as DEFAULT_URLS,
  normalizeRelayList,
} from '@/shared/lib/nostr/outbox/defaults';
import {
  SILENT_READS_BEFORE_LEFT_OUT,
  forgetSilentRelays,
} from '@/shared/lib/nostr/ownReplaceableEvent';

type FakeEvent = {
  kind: number;
  pubkey: string;
  created_at: number;
  id: string;
  tags: string[][];
  sig: string;
};
type RelayAnswer = { events: FakeEvent[] } | 'silent' | 'fail';
type Asked = { filter: { authors: string[] }; relays: string[] };

const mockRelays = new Map<string, RelayAnswer>();
const mockAsked: Asked[] = [];
let mockGate: (filter: { authors: string[] }) => Promise<void> = () => Promise.resolve();
const mockPublishEvent = jest.fn();
const mockSeedPool = jest.fn();
const mockAppStateListeners = new Set<(state: string) => void>();
let mockOffline = false;
/** The active account, whose key the signer holds. */
let mockActive = 'a1'.repeat(32);
const mockProfileListeners = new Set<() => void>();
let mockClient: FakeClient;

/** A read of one relay, answered by `mockRelays`. */
function mockSubscription(
  url: string,
  filters: readonly { authors?: string[] }[],
  handlers: RelaySubscriptionHandlers
) {
  const filter = filters[0] as { authors: string[] };
  mockAsked.push({ filter, relays: [url] });
  // A relay whose request cannot be made fails the read at once.
  if (mockRelays.get(url) === 'fail') {
    handlers.onError?.(new Error('relay failed'));
    return { stop: () => undefined };
  }
  void (async () => {
    await mockGate(filter);
    const answer = mockRelays.get(url) ?? { events: [] };
    if (answer === 'fail') return handlers.onError?.(new Error('relay failed'));
    if (answer === 'silent') return;
    for (const event of answer.events) {
      if (filter.authors.includes(event.pubkey)) handlers.onEvent(event as never);
    }
    handlers.onEose();
  })();
  return { stop: () => undefined };
}

jest.mock('nostr-tools/pure', () =>
  jest.requireActual('./helpers/fakeNostrClient').pureTrustingFakeEvents()
);
jest.mock('@/shared/lib/nostr/publish', () => ({
  publishEvent: (...args: unknown[]) => mockPublishEvent(...args),
}));
jest.mock('@/shared/lib/nostr/outbox/seedPool', () => ({
  seedPool: (...args: unknown[]) => mockSeedPool(...args),
}));
jest.mock('@/runtime/connectivity', () => ({
  useOfflineStatus: () => ({ isOffline: mockOffline }),
}));
jest.mock('react-native-web/dist/exports/AppState', () => ({
  __esModule: true,
  default: {
    addEventListener: (_type: string, listener: (state: string) => void) => {
      mockAppStateListeners.add(listener);
      return { remove: () => mockAppStateListeners.delete(listener) };
    },
  },
}));
jest.mock('@/shared/stores/global/profileStore', () =>
  jest
    .requireActual<typeof import('./helpers/profileStoreMock')>('./helpers/profileStoreMock')
    .activeAccountReaders(
      () => ({ getActiveProfile: () => ({ pubkey: mockActive }) }),
      (listener) => {
        const notify = () => listener({});
        mockProfileListeners.add(notify);
        return () => mockProfileListeners.delete(notify);
      }
    )
);
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }),
}));

const A = 'a1'.repeat(32);
const B = 'b2'.repeat(32);
const NOW_SEC = 1_790_000_000;
/** The default relays as the app reads and writes them, normalized. */
const DEFAULT_RELAYS = normalizeRelayList(DEFAULT_URLS);
const [DAMUS, NOS, ...OTHER_DEFAULTS] = DEFAULT_RELAYS;

let mockEventSeq = 0;
function relayList(pubkey: string, createdAt: number, urls: string[]): FakeEvent {
  const id = (++mockEventSeq).toString(16).padStart(64, '0');
  return {
    kind: 10002,
    pubkey,
    created_at: createdAt,
    id,
    tags: urls.map((url) => ['r', url]),
    sig: 'sig',
  };
}

const REMOTE = () => ({
  ...relayList(A, 500, []),
  tags: [
    ['r', 'wss://both.example/'],
    ['r', 'wss://write.example/', 'write'],
  ],
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const store = () => useRelayListStore.getState();

async function mountAndWait(pubkey: string | undefined, enabled = true) {
  const view = renderHook(
    (props: { pubkey?: string; enabled: boolean }) =>
      useOwnRelayListSync(props.enabled ? mockClient : undefined, props.pubkey),
    { initialProps: { pubkey, enabled } }
  );
  await act(async () => {
    jest.advanceTimersByTime(1_500);
  });
  return view;
}

/** Every asked relay held back until the read gives up. */
async function waitOutRead() {
  await act(async () => {
    jest.advanceTimersByTime(12_000);
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW_SEC * 1000 });
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
  mockAppStateListeners.clear();
  mockOffline = false;
  mockRelays.clear();
  mockAsked.length = 0;
  mockGate = () => Promise.resolve();
  mockActive = A;
  const signer = fakeSigner(A);
  Object.defineProperty(signer, 'pubkey', { get: () => mockActive });
  mockClient = fakeClient({ signer, subscribeRelay: mockSubscription });
  forgetSilentRelays();
  mockPublishEvent.mockReset();
  mockPublishEvent.mockReturnValue(okAsync({ accepted: [] }));
  mockSeedPool.mockReset();
  useRelayListStore.setState({
    entries: [],
    updatedAt: 0,
    hasPublished: false,
    source: 'default',
    discoveredFor: null,
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('reading the own relay list', () => {
  it('waits 1.5 s, reads kind:10002 for the account, and takes it into the store and the pool', async () => {
    mockRelays.set(DAMUS, { events: [REMOTE()] });
    renderHook(() => useOwnRelayListSync(mockClient, A));
    await act(async () => {
      jest.advanceTimersByTime(1_499);
    });
    expect(mockAsked).toHaveLength(0);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });

    expect(mockAsked[0].filter).toEqual({ kinds: [10002], authors: [A] });
    expect(store()).toMatchObject({
      entries: [
        { url: 'wss://both.example/', read: true, write: true },
        { url: 'wss://write.example/', read: false, write: true },
      ],
      updatedAt: 500,
      source: 'relay',
      hasPublished: true,
      discoveredFor: A,
    });
    expect(mockSeedPool).toHaveBeenCalledWith(mockClient, [
      'wss://both.example/',
      'wss://write.example/',
    ]);
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it('asks each saved write relay and each default relay on its own', async () => {
    useRelayListStore.setState({
      entries: [
        { url: 'wss://mine.example/', read: true, write: true },
        { url: 'wss://read-only.example/', read: true, write: false },
        { url: DAMUS, read: false, write: true },
      ],
      source: 'relay',
      updatedAt: 100,
      hasPublished: true,
    });
    await mountAndWait(A);

    expect(mockAsked.map((asked) => asked.relays)).toEqual(
      ['wss://mine.example/', ...DEFAULT_RELAYS].map((url) => [url])
    );
  });

  it('takes the newest list any relay holds once every relay has answered', async () => {
    mockRelays.set(DAMUS, { events: [relayList(A, 400, ['wss://old.example/'])] });
    mockRelays.set(NOS, { events: [relayList(A, 600, ['wss://new.example/'])] });
    await mountAndWait(A);

    expect(store()).toMatchObject({ updatedAt: 600, discoveredFor: A });
    expect(store().entries.map((e) => e.url)).toEqual(['wss://new.example/']);
    expect(getKnownOwnWriteRelays(A)).toEqual(['wss://new.example/']);
  });

  it.each([
    ['not ready', A, false],
    ['signed out', undefined, true],
  ])('does nothing while %s', async (_label, pubkey, enabled) => {
    await mountAndWait(pubkey, enabled);
    expect(mockAsked).toHaveLength(0);
  });

  it('keeps a relay-sourced list of the same or a newer time, but still seeds the pool', async () => {
    useRelayListStore.setState({
      entries: [{ url: 'wss://kept.example/', read: true, write: true }],
      updatedAt: 500,
      source: 'relay',
    });
    mockRelays.set(DAMUS, { events: [REMOTE()] });
    await mountAndWait(A);

    expect(store().entries).toEqual([{ url: 'wss://kept.example/', read: true, write: true }]);
    // QUIRK: the pool is seeded with the fetched list even when the store kept
    // its own.
    expect(mockSeedPool).toHaveBeenCalledWith(mockClient, [
      'wss://both.example/',
      'wss://write.example/',
    ]);
  });

  it('preserves an ambiguous saved local proposal while learning the remote destinations', async () => {
    useRelayListStore.setState({
      entries: [{ url: 'wss://local-edit.example/', read: true, write: true }],
      updatedAt: 900,
      source: 'local',
    });
    mockRelays.set('wss://local-edit.example/', { events: [REMOTE()] });
    await mountAndWait(A);
    expect(store()).toMatchObject({ updatedAt: 900, source: 'local' });
    expect(store().entries).toEqual([
      { url: 'wss://local-edit.example/', read: true, write: true },
    ]);
    expect(mockPublishEvent).not.toHaveBeenCalled();
    expect(getKnownOwnWriteRelays(A)).toBeNull();
  });

  it('writes nothing when the read fails', async () => {
    mockRelays.set(DAMUS, 'fail');
    await mountAndWait(A);
    await waitOutRead();
    expect(store()).toMatchObject({
      entries: [],
      hasPublished: false,
      source: 'default',
      discoveredFor: null,
    });
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });
});

describe('what counts as an answer', () => {
  it('does not take a list as known when no relay answers', async () => {
    for (const url of DEFAULT_RELAYS) mockRelays.set(url, 'silent');
    await mountAndWait(A);
    await waitOutRead();

    expect(getKnownOwnWriteRelays(A)).toBeNull();
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it('does not take an older list as known while another relay has not answered', async () => {
    mockRelays.set(DAMUS, { events: [relayList(A, 400, ['wss://old.example/'])] });
    mockRelays.set(NOS, 'silent');
    await mountAndWait(A);
    await waitOutRead();

    expect(getKnownOwnWriteRelays(A)).toBeNull();
    // What did arrive is shown all the same.
    expect(store().entries.map((e) => e.url)).toEqual(['wss://old.example/']);
  });

  it('does not take one relay saying there is none as none while the others are silent', async () => {
    for (const url of [NOS, ...OTHER_DEFAULTS]) mockRelays.set(url, 'silent');
    await mountAndWait(A);
    await waitOutRead();

    expect(getKnownOwnWriteRelays(A)).toBeNull();
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it('does not publish the defaults while a saved write relay has not answered', async () => {
    useRelayListStore.setState({
      entries: [{ url: 'wss://mine.example/', read: true, write: true }],
      source: 'local',
    });
    mockRelays.set('wss://mine.example/', 'silent');
    await mountAndWait(A);
    await waitOutRead();

    expect(getKnownOwnWriteRelays(A)).toBeNull();
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });
});

describe('first-run publish of the default relays', () => {
  it('publishes the defaults once to the default relays when every relay says there is no list', async () => {
    await mountAndWait(A);

    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
    const { event, relays, resolveOn } = mockPublishEvent.mock.calls[0][0];
    expect(event.kind).toBe(10002);
    // Signed by the account, stamped when the 1.5 s delay ends.
    expect(event.pubkey).toBe(A);
    expect(event.created_at).toBe(NOW_SEC + 1);
    expect(event.tags).toEqual(DEFAULT_URLS.map((url) => ['r', url]));
    expect(relays).toEqual([...DEFAULT_RELAYS]);
    expect(resolveOn).toBe('all-settled');
    // The saved list is the list published.
    expect(store()).toMatchObject({
      entries: DEFAULT_URLS.map((url) => ({ url, read: true, write: true })),
      updatedAt: NOW_SEC + 1,
      hasPublished: true,
      source: 'relay',
    });
  });

  it('leaves an edit made before the first-run answer to the person to publish', async () => {
    const read = deferred();
    mockGate = () => read.promise;
    renderHook(() => useOwnRelayListSync(mockClient, A));
    await act(async () => {
      jest.advanceTimersByTime(1_500);
    });
    // The person adds a relay in Network settings while the read is out.
    store().addRelay('wss://mine.example/', { read: true, write: true });
    await act(async () => read.resolve());

    // Neither replaced by the defaults nor marked published: Network settings
    // still offers it as a saved proposal for an explicit review.
    expect(mockPublishEvent).not.toHaveBeenCalled();
    expect(store()).toMatchObject({ source: 'local', hasPublished: false });
    expect(store().entries.map((e) => e.url)).toEqual([...DEFAULT_URLS, 'wss://mine.example/']);
    expect(getKnownOwnWriteRelays(A)).toBeNull();
  });

  it('after the first-run publish, adding one relay keeps the defaults', async () => {
    await mountAndWait(A);
    store().addRelay('wss://mine.example/', { read: true, write: true });

    expect(store().entries.map((e) => e.url)).toEqual([...DEFAULT_URLS, 'wss://mine.example/']);
  });

  it('does not publish again once a list was published', async () => {
    useRelayListStore.setState({ hasPublished: true });
    await mountAndWait(A);
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it('leaves the list unpublished when no relay accepts, so the next start tries again', async () => {
    mockPublishEvent.mockReturnValueOnce(errAsync({ type: 'no-relay-accepted' }));
    const first = await mountAndWait(A);
    expect(store().hasPublished).toBe(false);
    // The defaults are the account's list all the same, for this session only.
    expect(store().discoveredFor).toBe(A);
    first.unmount();

    await mountAndWait(A);
    expect(mockPublishEvent).toHaveBeenCalledTimes(2);
    expect(store().hasPublished).toBe(true);
  });
});

describe('unmount and account change', () => {
  it('never reads when unmounted before the delay ends', async () => {
    const view = renderHook(() => useOwnRelayListSync(mockClient, A));
    view.unmount();
    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    expect(mockAsked).toHaveLength(0);
  });

  it("ignores the previous account's read that answers after a switch", async () => {
    const forA = deferred();
    mockGate = ({ authors }) => (authors[0] === A ? forA.promise : Promise.resolve());
    mockRelays.set(DAMUS, { events: [REMOTE()] });
    const view = await mountAndWait(A);
    mockActive = B;
    for (const listener of mockProfileListeners) listener();
    view.rerender({ pubkey: B, enabled: true });
    await act(async () => {
      jest.advanceTimersByTime(1_500);
    });
    await act(async () => forA.resolve());

    // A's list is not taken in: the store holds the defaults B published.
    expect(store().entries.map((e) => e.url)).toEqual([...DEFAULT_URLS]);
    expect(mockSeedPool).not.toHaveBeenCalled();
    // B's read found nothing, so B published the defaults.
    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
    expect(store().discoveredFor).toBe(B);
  });

  it('does not mark a publish that finished after unmount', async () => {
    const publish = deferred();
    mockPublishEvent.mockReturnValue(
      ResultAsync.fromSafePromise(publish.promise.then(() => ({ accepted: [] })))
    );
    const view = await mountAndWait(A);
    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => publish.resolve());
    expect(store().hasPublished).toBe(false);
  });
});

describe('a discovery that did not finish', () => {
  const triggers = {
    'returning to the foreground': () => {
      for (const listener of mockAppStateListeners) listener('active');
    },
    'a relay connecting': () => {
      mockClient.connect('wss://both.example/');
    },
  };

  it.each(Object.keys(triggers) as (keyof typeof triggers)[])(
    'leaves the list unknown and is tried again on %s',
    async (trigger) => {
      mockRelays.set(DAMUS, 'fail');
      const view = await mountAndWait(A);
      await waitOutRead();
      expect(getKnownOwnWriteRelays(A)).toBeNull();

      mockRelays.set(DAMUS, { events: [REMOTE()] });
      const asked = mockAsked.length;
      await act(async () => triggers[trigger]());

      expect(mockAsked.length).toBeGreaterThan(asked);
      expect(getKnownOwnWriteRelays(A)).toEqual(['wss://both.example/', 'wss://write.example/']);
      view.unmount();
    }
  );

  it('treats a read the relays did not finish answering in 12 s as unanswered, not as no list, and reads again', async () => {
    mockRelays.set(NOS, 'silent');
    const view = await mountAndWait(A);
    await waitOutRead();
    expect(getKnownOwnWriteRelays(A)).toBeNull();
    expect(mockPublishEvent).not.toHaveBeenCalled();

    // The second read began at once, while NOS was still silent; the third hears it.
    mockRelays.delete(NOS);
    await waitOutRead();
    expect(getKnownOwnWriteRelays(A)).toEqual([...DEFAULT_URLS]);
    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
    expect(mockPublishEvent.mock.calls[0][0].relays).toEqual([...DEFAULT_RELAYS]);
    view.unmount();
  });

  it('reads without a default relay silent three reads in a row, and publishes the defaults to the others', async () => {
    mockRelays.set(NOS, 'silent');
    const view = await mountAndWait(A);
    for (let read = 1; read < SILENT_READS_BEFORE_LEFT_OUT; read++) await waitOutRead();
    expect(getKnownOwnWriteRelays(A)).toBeNull();

    await waitOutRead();
    expect(getKnownOwnWriteRelays(A)).toEqual([...DEFAULT_URLS]);
    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
    const { event, relays } = mockPublishEvent.mock.calls[0][0];
    // The list still names every default; only the silent one is not sent it.
    expect(event.tags).toEqual(DEFAULT_URLS.map((url) => ['r', url]));
    expect(relays).toEqual(DEFAULT_RELAYS.filter((url) => url !== NOS));
    view.unmount();
  });

  it('is tried again when the network comes back', async () => {
    mockOffline = true;
    mockRelays.set(DAMUS, 'fail');
    const view = await mountAndWait(A);
    await waitOutRead();
    expect(getKnownOwnWriteRelays(A)).toBeNull();

    mockOffline = false;
    mockRelays.set(DAMUS, { events: [REMOTE()] });
    await act(async () => view.rerender({ pubkey: A, enabled: true }));

    expect(getKnownOwnWriteRelays(A)).toEqual(['wss://both.example/', 'wss://write.example/']);
    view.unmount();
  });

  describe('when the saved write relay that holds the newer list is down', () => {
    // R, the saved write relay, holds the newer list but is down; a default
    // relay answers with an older list that names S instead.
    const R = 'wss://mine.example/';
    const S = 'wss://stale.example/';
    beforeEach(() => {
      useRelayListStore.setState({
        entries: [{ url: R, read: true, write: true }],
        source: 'relay',
        updatedAt: 100,
        hasPublished: true,
      });
      mockRelays.set(R, 'silent');
      mockRelays.set(DAMUS, { events: [relayList(A, 400, [S])] });
    });

    it('asks again every relay an earlier attempt asked, though a partial answer has replaced them', async () => {
      const view = await mountAndWait(A);
      await waitOutRead();
      // The partial answer is shown, but is not known.
      expect(store().entries.map((e) => e.url)).toEqual([S]);
      expect(getKnownOwnWriteRelays(A)).toBeNull();

      // The next read began at once; every relay but R answers it: still not known.
      const asked = mockAsked.length;
      mockRelays.set(R, { events: [relayList(A, 900, ['wss://new.example/'])] });
      await waitOutRead();
      expect(mockAsked.slice(asked).map((a) => a.relays[0])).toEqual(
        expect.arrayContaining([R, S, ...DEFAULT_RELAYS])
      );
      // R answers the read after with the newer list: that is the account's list.
      expect(getKnownOwnWriteRelays(A)).toEqual(['wss://new.example/']);
      expect(mockPublishEvent).not.toHaveBeenCalled();
      view.unmount();
    });

    it('takes the older list as known once R has been silent three reads in a row', async () => {
      const view = await mountAndWait(A);
      for (let read = 0; read < SILENT_READS_BEFORE_LEFT_OUT; read++) await waitOutRead();

      // The risk the owner accepted (F227, F239): the newer list on R is overruled.
      expect(getKnownOwnWriteRelays(A)).toEqual([S]);
      expect(mockPublishEvent).not.toHaveBeenCalled();
      view.unmount();
    });
  });

  it('is not tried again once it has finished', async () => {
    mockRelays.set(DAMUS, { events: [REMOTE()] });
    const view = await mountAndWait(A);
    const asked = mockAsked.length;
    await act(async () => triggers['returning to the foreground']());
    expect(mockAsked).toHaveLength(asked);
    view.unmount();
  });
});

it('stops discovery after alternating relay timeouts and waits for a wakeup', async () => {
  let calls = 0;
  mockGate = async () => {
    const attempt = Math.floor(calls++ / DEFAULT_RELAYS.length);
    mockRelays.set(DAMUS, attempt % 2 === 0 ? 'silent' : { events: [] });
    mockRelays.set(NOS, attempt % 2 === 1 ? 'silent' : { events: [] });
  };
  const view = await mountAndWait(A);
  for (let i = 0; i < 4; i++) await waitOutRead();
  const reads = mockAsked.length;
  await waitOutRead();
  expect(mockAsked.length).toBe(reads);
  expect(getKnownOwnWriteRelays(A)).toBeNull();
  expect(mockPublishEvent).not.toHaveBeenCalled();
  view.unmount();
});

it('reads and publishes to a learned old write relay removed before its first query', async () => {
  const old = 'wss://learned-old.example/';
  const next = 'wss://new.example/';
  mockRelays.set(DAMUS, { events: [relayList(A, 500, [old])] });
  const view = await mountAndWait(A);
  expect(mockAsked.flatMap((read) => read.relays)).not.toContain(old);
  expect(store().entries.map((entry) => entry.url)).toEqual([old]);
  store().removeRelay(old);
  store().addRelay(next, { read: true, write: true });
  await act(async () => {
    const result = await beginRelayListEdit(mockClient, A);
    if (result.isErr()) throw new Error(result.error.type);
    try {
      await result.value.review(store().entries).publish();
    } finally {
      result.value.dispose();
    }
  });
  expect(mockAsked.flatMap((read) => read.relays)).toContain(old);
  expect(mockPublishEvent.mock.calls.at(-1)![0].relays).toEqual(
    expect.arrayContaining([old, next])
  );
  view.unmount();
});
