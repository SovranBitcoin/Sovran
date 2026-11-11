/**
 * @jest-environment node
 *
 * `useOwnRelayListSync`: after NDK is ready it reads the account's own NIP-65
 * relay list (kind:10002) and either takes it into the real relay-list store
 * and the relay pool, or, when the network has none, publishes the default
 * relays once. Pinned: what it reads, what it writes where, the
 * last-writer rule (equal timestamps included), and what an unmount or
 * account change does to a sync in flight.
 *
 * Replaced: the NDK fetch, the publish seam, the pool seeding and storage.
 */
import { act, renderHook } from '@testing-library/react-native';
import { ResultAsync, errAsync, okAsync } from 'neverthrow';

import { useOwnRelayListSync } from '@/shared/lib/nostr/outbox/useOwnRelayListSync';
import { useRelayListStore } from '@/shared/lib/nostr/outbox/relayListStore';
import { DEFAULT_RELAYS } from '@/shared/lib/nostr/outbox/defaults';

const mockFetchEvent = jest.fn();
const mockPublishEvent = jest.fn();
const mockSeedPool = jest.fn();
let mockNdk: { fetchEvent: jest.Mock } | null;

jest.mock('@nostr-dev-kit/ndk-mobile', () => ({
  ...jest.requireActual('@nostr-dev-kit/ndk-mobile'),
  NDKEvent: class NDKEvent {
    kind = 0;
    created_at = 0;
    tags: string[][] = [];
  },
  useNDK: () => ({ ndk: mockNdk }),
}));
jest.mock('@/shared/lib/nostr/publish', () => ({
  publishEvent: (...args: unknown[]) => mockPublishEvent(...args),
}));
jest.mock('@/shared/lib/nostr/outbox/seedPool', () => ({
  seedPool: (...args: unknown[]) => mockSeedPool(...args),
}));
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
const REMOTE = {
  created_at: 500,
  tags: [
    ['r', 'wss://both.example'],
    ['r', 'wss://write.example', 'write'],
  ],
};

function deferred<T>() {
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
      useOwnRelayListSync(props.pubkey, props.enabled),
    { initialProps: { pubkey, enabled } }
  );
  await act(async () => {
    jest.advanceTimersByTime(1_500);
  });
  return view;
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW_SEC * 1000 });
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
  mockNdk = { fetchEvent: mockFetchEvent };
  mockFetchEvent.mockReset();
  mockFetchEvent.mockResolvedValue(null);
  mockPublishEvent.mockReset();
  mockPublishEvent.mockReturnValue(okAsync({ accepted: [] }));
  mockSeedPool.mockReset();
  useRelayListStore.setState({
    entries: [],
    updatedAt: 0,
    hasPublished: false,
    source: 'default',
    noListFoundFor: null,
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('reading the own relay list', () => {
  it('waits 1.5 s, reads kind:10002 for the account, and takes it into the store and the pool', async () => {
    mockFetchEvent.mockResolvedValue(REMOTE);
    renderHook(() => useOwnRelayListSync(A, true));
    await act(async () => {
      jest.advanceTimersByTime(1_499);
    });
    expect(mockFetchEvent).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });

    expect(mockFetchEvent).toHaveBeenCalledWith({ kinds: [10002], authors: [A] });
    expect(store()).toMatchObject({
      entries: [
        { url: 'wss://both.example', read: true, write: true },
        { url: 'wss://write.example', read: false, write: true },
      ],
      updatedAt: 500,
      source: 'relay',
      hasPublished: true,
    });
    expect(mockSeedPool).toHaveBeenCalledWith(mockNdk, [
      'wss://both.example',
      'wss://write.example',
    ]);
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['not ready', A, false],
    ['signed out', undefined, true],
  ])('does nothing while %s', async (_label, pubkey, enabled) => {
    await mountAndWait(pubkey, enabled);
    expect(mockFetchEvent).not.toHaveBeenCalled();
  });

  it('keeps a relay-sourced list of the same or a newer time, but still seeds the pool', async () => {
    useRelayListStore.setState({
      entries: [{ url: 'wss://kept.example', read: true, write: true }],
      updatedAt: 500,
      source: 'relay',
    });
    mockFetchEvent.mockResolvedValue(REMOTE);
    await mountAndWait(A);

    expect(store().entries).toEqual([{ url: 'wss://kept.example', read: true, write: true }]);
    // QUIRK: the pool is seeded with the fetched list even when the store kept
    // its own.
    expect(mockSeedPool).toHaveBeenCalledWith(mockNdk, [
      'wss://both.example',
      'wss://write.example',
    ]);
  });

  it('replaces local edits with any fetched list, even an older one', async () => {
    useRelayListStore.setState({
      entries: [{ url: 'wss://local-edit.example', read: true, write: true }],
      updatedAt: 900,
      source: 'local',
    });
    mockFetchEvent.mockResolvedValue(REMOTE);
    await mountAndWait(A);

    // QUIRK: the last-writer guard applies only to a relay-sourced list, so an
    // older network list (500) overwrites newer local edits (900).
    expect(store()).toMatchObject({ updatedAt: 500, source: 'relay' });
    expect(store().entries.map((e) => e.url)).toEqual([
      'wss://both.example',
      'wss://write.example',
    ]);
  });

  it('writes nothing when the read fails', async () => {
    mockFetchEvent.mockRejectedValue(new Error('offline'));
    await mountAndWait(A);
    expect(store()).toMatchObject({
      entries: [],
      hasPublished: false,
      source: 'default',
      noListFoundFor: null,
    });
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });
});

describe('first-run publish of the default relays', () => {
  it('publishes the defaults once to the default relays when the network has no list', async () => {
    await mountAndWait(A);

    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
    const { event, relays, resolveOn } = mockPublishEvent.mock.calls[0][0];
    expect(event.kind).toBe(10002);
    // Stamped when the 1.5 s delay ends.
    expect(event.created_at).toBe(NOW_SEC + 1);
    expect(event.tags).toEqual(DEFAULT_RELAYS.map((url) => ['r', url]));
    expect(relays).toEqual([...DEFAULT_RELAYS]);
    expect(resolveOn).toBe('all-settled');
    // The store records the publish but keeps its (empty) entries.
    expect(store()).toMatchObject({
      entries: [],
      updatedAt: NOW_SEC + 1,
      hasPublished: true,
      source: 'relay',
    });
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
    expect(store().noListFoundFor).toBe(A);
    first.unmount();

    await mountAndWait(A);
    expect(mockPublishEvent).toHaveBeenCalledTimes(2);
    expect(store().hasPublished).toBe(true);
  });
});

describe('unmount and account change', () => {
  it('never reads when unmounted before the delay ends', async () => {
    const view = renderHook(() => useOwnRelayListSync(A, true));
    view.unmount();
    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    expect(mockFetchEvent).not.toHaveBeenCalled();
  });

  it("ignores the previous account's read that answers after a switch", async () => {
    const forA = deferred<typeof REMOTE | null>();
    mockFetchEvent.mockImplementation(({ authors }: { authors: string[] }) =>
      authors[0] === A ? forA.promise : Promise.resolve(null)
    );
    const view = await mountAndWait(A);
    view.rerender({ pubkey: B, enabled: true });
    await act(async () => {
      jest.advanceTimersByTime(1_500);
    });
    await act(async () => forA.resolve(REMOTE));

    expect(store().entries).toEqual([]);
    expect(mockSeedPool).not.toHaveBeenCalled();
    // B's read found nothing, so B published the defaults.
    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
    expect(store().noListFoundFor).toBe(B);
  });

  it('does not mark a publish that finished after unmount', async () => {
    const publish = deferred<void>();
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
