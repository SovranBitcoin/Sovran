/**
 * @jest-environment node
 *
 * Three startup syncs for the person's own Nostr account:
 *
 * - `useOwnSocialGraphSeed` reads the follow list once per account from the
 *   tiered data layer and seeds the real social store through its
 *   last-writer-wins gate.
 * - `useMuteListSync` restores the mute list once the NDK, keys and the
 *   ignore store are ready, and again on every return to the foreground.
 *
 * - `useFollowSync` starts the follow worker once the social store has
 *   loaded, on each tap, when a follow list arrives and on each return to the
 *   foreground.
 *
 * Replaced: the follow worker, the keys provider, the data layer, the NDK hooks, the mute-list
 * fetch, the relay list and the ignore store's hydration, and AppState.
 */
import { act, renderHook } from '@testing-library/react-native';
import { err, ok } from 'neverthrow';

import { useFollowSync } from '@/shared/lib/nostr/ownsync/useFollowSync';
import { useMuteListSync } from '@/shared/lib/nostr/ownsync/useMuteListSync';
import { useOwnSocialGraphSeed } from '@/shared/lib/nostr/ownsync/useOwnSocialGraphSeed';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';

let mockPubkey: string | undefined;
let mockLayer: { getSocialGraph: jest.Mock } | null;
let mockNdk: object | null;
let mockInitialized = true;
let mockOffline = false;
let mockHydrated = true;
let mockWriteRelays = ['wss://w1.example'];
const mockSyncMuteList = jest.fn();
const mockHydrationListeners = new Set<() => void>();
const mockAppStateListeners = new Set<(state: string) => void>();

jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: mockPubkey ? { pubkey: mockPubkey } : null }),
}));
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => mockLayer,
}));
jest.mock('@nostr-dev-kit/ndk-mobile', () => ({ useNDK: () => ({ ndk: mockNdk }) }));
jest.mock('@/shared/providers/NostrNDKProvider', () => ({
  useNostrNDKContext: () => ({ isInitialized: mockInitialized }),
}));
jest.mock('@/shared/providers/OfflineProvider', () => ({
  useOfflineStatus: () => ({ isOffline: mockOffline }),
}));
jest.mock('@/shared/lib/nostr/moderation', () => ({
  syncMuteList: (...args: unknown[]) => mockSyncMuteList(...args),
}));
const mockRequestFollowSync = jest.fn();
jest.mock('@/shared/lib/nostr/followSync', () => ({
  requestFollowSync: (...args: unknown[]) => mockRequestFollowSync(...args),
}));
jest.mock('@/shared/lib/nostr/outbox/relayListStore', () => ({
  useRelayListStore: Object.assign(
    (select: (s: { entries: { url: string; write: boolean }[] }) => unknown) =>
      select({
        entries: [
          ...mockWriteRelays.map((url) => ({ url, write: true })),
          { url: 'wss://read-only.example', write: false },
        ],
      }),
    {
      subscribe: () => () => undefined,
      persist: { onFinishHydration: () => () => undefined },
    }
  ),
}));
jest.mock('@/features/feed/stores/ignoreStore', () => ({
  useFeedIgnoreStore: {
    persist: {
      hasHydrated: () => mockHydrated,
      onFinishHydration: (listener: () => void) => {
        mockHydrationListeners.add(listener);
        return () => mockHydrationListeners.delete(listener);
      },
    },
  },
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

const A = 'a1'.repeat(32);
const B = 'b2'.repeat(32);
const F1 = 'f1'.repeat(32);
const F2 = 'f2'.repeat(32);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const graph = (follows: string[], contactsUpdatedAt: number) =>
  ok({ tier: 'nagg', follows, contactsUpdatedAt });

const following = () => Object.keys(useNostrSocialStore.getState().followingPubkeys).sort();

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
  mockPubkey = A;
  mockLayer = { getSocialGraph: jest.fn(async () => graph([F1], 100)) };
  mockNdk = { id: 'ndk', pool: { on: () => undefined, off: () => undefined } };
  mockInitialized = true;
  mockOffline = false;
  mockHydrated = true;
  mockWriteRelays = ['wss://w1.example'];
  mockSyncMuteList.mockReset();
  mockSyncMuteList.mockResolvedValue(undefined);
  mockHydrationListeners.clear();
  mockAppStateListeners.clear();
  useNostrSocialStore.setState({ followingPubkeys: {}, contactsUpdatedAt: 0 });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useOwnSocialGraphSeed', () => {
  it('seeds the follow list once for the signed-in account', async () => {
    const view = renderHook(() => useOwnSocialGraphSeed());
    await act(async () => undefined);

    expect(mockLayer!.getSocialGraph.mock.calls).toEqual([[{ pubkey: A }]]);
    expect(following()).toEqual([F1]);
    expect(useNostrSocialStore.getState().contactsUpdatedAt).toBe(100);

    view.rerender({});
    await act(async () => undefined);
    expect(mockLayer!.getSocialGraph).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a signed-in account', async () => {
    mockPubkey = undefined;
    renderHook(() => useOwnSocialGraphSeed());
    await act(async () => undefined);
    expect(mockLayer!.getSocialGraph).not.toHaveBeenCalled();
  });

  it('keeps a list at least as new as the seed (equal timestamps keep the current one)', async () => {
    useNostrSocialStore.setState({ followingPubkeys: { [F2]: true }, contactsUpdatedAt: 100 });
    renderHook(() => useOwnSocialGraphSeed());
    await act(async () => undefined);
    expect(following()).toEqual([F2]);

    useNostrSocialStore.setState({ contactsUpdatedAt: 99 });
    mockPubkey = B;
    renderHook(() => useOwnSocialGraphSeed());
    await act(async () => undefined);
    expect(following()).toEqual([F1]);
    expect(useNostrSocialStore.getState().contactsUpdatedAt).toBe(100);
  });

  it('leaves the store alone when every tier fails', async () => {
    mockLayer!.getSocialGraph.mockResolvedValue(
      err({ attempts: [{ tier: 'nagg', outcome: 'x' }] })
    );
    renderHook(() => useOwnSocialGraphSeed());
    await act(async () => undefined);
    expect(following()).toEqual([]);
  });

  it('marks the account seeded even when no tier exists, and never retries it', async () => {
    mockLayer = null;
    const view = renderHook(() => useOwnSocialGraphSeed());
    await act(async () => undefined);

    // QUIRK: the account counts as seeded before the hook knows a tier
    // exists, so a data layer that appears later is never asked for it.
    mockLayer = { getSocialGraph: jest.fn(async () => graph([F1], 100)) };
    view.rerender({});
    await act(async () => undefined);
    expect(mockLayer.getSocialGraph).not.toHaveBeenCalled();
  });

  it("drops the previous account's late answer after a switch and seeds the new one", async () => {
    const forA = deferred<ReturnType<typeof graph>>();
    mockLayer!.getSocialGraph.mockImplementation(({ pubkey }: { pubkey: string }) =>
      pubkey === A ? forA.promise : Promise.resolve(graph([F2], 200))
    );
    const view = renderHook(() => useOwnSocialGraphSeed());
    mockPubkey = B;
    view.rerender({});
    await act(async () => undefined);
    expect(following()).toEqual([F2]);

    await act(async () => forA.resolve(graph([F1], 300)));
    expect(following()).toEqual([F2]);
  });

  it('drops an answer that arrives after unmount', async () => {
    const pending = deferred<ReturnType<typeof graph>>();
    mockLayer!.getSocialGraph.mockReturnValue(pending.promise);
    const view = renderHook(() => useOwnSocialGraphSeed());
    view.unmount();
    await act(async () => pending.resolve(graph([F1], 100)));
    expect(following()).toEqual([]);
  });

  it('seeds an account again after switching away and back', async () => {
    const view = renderHook(() => useOwnSocialGraphSeed());
    await act(async () => undefined);
    mockPubkey = B;
    view.rerender({});
    await act(async () => undefined);
    mockPubkey = A;
    view.rerender({});
    await act(async () => undefined);
    expect(mockLayer!.getSocialGraph.mock.calls.map(([arg]) => arg.pubkey)).toEqual([A, B, A]);
  });
});

describe('useMuteListSync', () => {
  const foreground = (state = 'active') =>
    act(async () => {
      for (const listener of [...mockAppStateListeners]) listener(state);
    });

  it('restores the mute list once when ready, with the NDK and the account', async () => {
    renderHook(() => useMuteListSync());
    await act(async () => undefined);
    expect(mockSyncMuteList.mock.calls).toEqual([[mockNdk, A]]);
  });

  it.each([
    ['the NDK is not initialized', () => (mockInitialized = false)],
    ['there is no NDK', () => (mockNdk = null)],
    ['there is no account', () => (mockPubkey = undefined)],
  ])('does nothing while %s', async (_label, arrange) => {
    arrange();
    renderHook(() => useMuteListSync());
    await foreground();
    expect(mockSyncMuteList).not.toHaveBeenCalled();
  });

  it('waits for the ignore store to hydrate, then restores', async () => {
    mockHydrated = false;
    renderHook(() => useMuteListSync());
    await act(async () => undefined);
    expect(mockSyncMuteList).not.toHaveBeenCalled();

    mockHydrated = true;
    await act(async () => {
      for (const listener of [...mockHydrationListeners]) listener();
    });
    expect(mockSyncMuteList).toHaveBeenCalledTimes(1);
  });

  it('refreshes on each return to the foreground, not on going to the background', async () => {
    renderHook(() => useMuteListSync());
    await act(async () => undefined);
    await foreground('background');
    await foreground('active');
    await foreground('active');
    expect(mockSyncMuteList).toHaveBeenCalledTimes(3);
  });

  it('runs one refresh at a time and retries after a failure', async () => {
    const first = deferred<void>();
    mockSyncMuteList.mockReturnValueOnce(first.promise);
    renderHook(() => useMuteListSync());
    await foreground();
    expect(mockSyncMuteList).toHaveBeenCalledTimes(1);

    await act(async () => first.reject(new Error('relay down')));
    await foreground();
    expect(mockSyncMuteList).toHaveBeenCalledTimes(2);
  });

  it('restores again when the write relays or the account change', async () => {
    const view = renderHook(() => useMuteListSync());
    await act(async () => undefined);
    mockWriteRelays = ['wss://w2.example'];
    view.rerender({});
    await act(async () => undefined);
    mockPubkey = B;
    view.rerender({});
    await act(async () => undefined);
    expect(mockSyncMuteList.mock.calls.map(([, pubkey]) => pubkey)).toEqual([A, A, B]);
    expect(mockAppStateListeners.size).toBe(1);
    expect(mockHydrationListeners.size).toBe(1);
  });

  it('stops listening on unmount', async () => {
    const view = renderHook(() => useMuteListSync());
    await act(async () => undefined);
    view.unmount();
    expect(mockAppStateListeners.size).toBe(0);
    expect(mockHydrationListeners.size).toBe(0);
  });
});

describe('useFollowSync', () => {
  let socialHydrated = true;
  const socialHydrationListeners = new Set<() => void>();

  beforeEach(() => {
    mockRequestFollowSync.mockReset();
    socialHydrated = true;
    socialHydrationListeners.clear();
    jest.spyOn(useNostrSocialStore.persist, 'hasHydrated').mockImplementation(() => socialHydrated);
    jest.spyOn(useNostrSocialStore.persist, 'onFinishHydration').mockImplementation((listener) => {
      const wrapped = () => listener(useNostrSocialStore.getState());
      socialHydrationListeners.add(wrapped);
      return () => socialHydrationListeners.delete(wrapped);
    });
  });

  const calls = () => mockRequestFollowSync.mock.calls.map(([ndk, pubkey]) => [ndk, pubkey]);
  const foreground = (state = 'active') =>
    act(async () => {
      for (const listener of [...mockAppStateListeners]) listener(state);
    });

  it('resumes saved follows once the account is ready, with the NDK and the account', async () => {
    renderHook(() => useFollowSync());
    await act(async () => undefined);
    expect(calls()).toEqual([[mockNdk, A]]);
  });

  it('waits for the social store to load, then resumes', async () => {
    socialHydrated = false;
    renderHook(() => useFollowSync());
    expect(mockRequestFollowSync).not.toHaveBeenCalled();
    socialHydrated = true;
    await act(async () => {
      for (const listener of socialHydrationListeners) listener();
    });
    expect(calls()).toEqual([[mockNdk, A]]);
  });

  it('waits for the NDK to initialize', async () => {
    mockInitialized = false;
    renderHook(() => useFollowSync());
    await act(async () => undefined);
    expect(mockRequestFollowSync).not.toHaveBeenCalled();
  });

  it('starts once the NDK and its signer are ready, without a tap', async () => {
    mockInitialized = false;
    const view = renderHook(() => useFollowSync());
    await act(async () => undefined);
    expect(mockRequestFollowSync).not.toHaveBeenCalled();
    mockInitialized = true;
    view.rerender({});
    await act(async () => undefined);
    expect(calls()).toEqual([[mockNdk, A]]);
  });

  it('starts again when the network comes back, without a tap or a return to the foreground', async () => {
    mockOffline = true;
    const view = renderHook(() => useFollowSync());
    await act(async () => undefined);
    expect(mockRequestFollowSync).not.toHaveBeenCalled();
    mockOffline = false;
    view.rerender({});
    await act(async () => undefined);
    expect(calls()).toEqual([[mockNdk, A]]);
  });

  it('starts on a tap and when a follow list arrives, not on other social writes', async () => {
    renderHook(() => useFollowSync());
    mockRequestFollowSync.mockClear();
    act(() => useNostrSocialStore.getState().setFollowIntent(F1, true));
    expect(mockRequestFollowSync).toHaveBeenCalledTimes(1);
    act(() =>
      useNostrSocialStore
        .getState()
        .setContactsFromRelay({ tags: [['p', F2]], content: '', createdAtSec: 500, eventId: 'e1' })
    );
    expect(mockRequestFollowSync).toHaveBeenCalledTimes(2);
    act(() => useNostrSocialStore.getState().markDeleteRequested('note-1'));
    expect(mockRequestFollowSync).toHaveBeenCalledTimes(2);
  });

  it('starts again on each return to the foreground and stops listening on unmount', async () => {
    const view = renderHook(() => useFollowSync());
    await foreground('background');
    await foreground('active');
    expect(mockRequestFollowSync).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(mockAppStateListeners.size).toBe(0);
    expect(socialHydrationListeners.size).toBe(0);
    act(() => useNostrSocialStore.getState().setFollowIntent(F2, true));
    expect(mockRequestFollowSync).toHaveBeenCalledTimes(2);
  });
});
