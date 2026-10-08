/** @jest-environment node */
import { AppState } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { DmEcashAutoRedeemProvider } from '@/features/payments/hooks/useDmEcashAutoRedeem';
import type { DmEnvelopePage } from '@/features/payments/data/dmEnvelopeTypes';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';

const mockFetch = jest.fn();
const mockDrain = jest.fn(async () => undefined);
const mockIntake = jest.fn();
const mockStillCurrent: boolean[] = [];
let mockQueueHasWork = false;
let mockActiveProfile: string | undefined = 'a'.repeat(64);
let mockHydrated = true;
let mockRetryAt: number | null = null;
let mockDue = false;
const mockHydrationListeners = new Set<() => void>();
let mockLive: ((page: DmEnvelopePage) => void) | undefined;

jest.mock('@/features/payments/data/dmEnvelopeClient', () => ({
  fetchDmEnvelopes: (params: unknown) => mockFetch(params),
  subscribeDmEnvelopesLive: (_viewer: string, onPage: (page: DmEnvelopePage) => void) => {
    mockLive = onPage;
    return () => undefined;
  },
}));
// One message per envelope, carrying the envelope id, so intake calls can be
// traced back to pages.
jest.mock('@/features/payments/data/dmDecryptPipeline', () => ({
  decryptDmEnvelopes: (envelopes: { id: string }[]) => envelopes.map(({ id }) => ({ id })),
}));
jest.mock('@/features/payments/lib/dmEcashIntake', () => ({
  intakeDmEcash: (dm: { id: string }, deps: { stillCurrent: () => boolean }) => {
    mockStillCurrent.push(deps.stillCurrent());
    return mockIntake(dm.id);
  },
}));
jest.mock('@/features/payments/lib/dmEcashRecovery', () => ({
  reconcileParkedMessageEcash: async () => false,
}));
jest.mock('@/features/nearPay/lib/nutDropAutoRedeem', () => ({
  drainNutDropRedeemQueue: () => mockDrain(),
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  getActiveProfilePubkey: () => mockActiveProfile,
}));
jest.mock('@/shared/lib/cashu/manager', () => ({ CocoManager: { isInitialized: () => false } }));
jest.mock('@/shared/lib/routstr/spentProbe', () => ({ isTokenSpent: jest.fn() }));
jest.mock('@/shared/lib/nostr/giftWrapCache', () => ({
  giftWrapCache: { cache: { hydrate: async () => undefined } },
}));
jest.mock('@/shared/lib/nostr/nip04Cache', () => ({
  nip04Cache: { hydrate: async () => undefined },
}));
jest.mock('@/shared/lib/protocolIds', () => ({ cashuP2pkPubkeyFromNostrHex: () => '02ab' }));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: { pubkey: 'a'.repeat(64), privateKey: 'b'.repeat(64) } }),
}));
// In-memory stand-ins: the real stores persist, and this suite has no storage.
jest.mock('@/shared/stores/global/walletLifecycleStore', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  return { useWalletLifecycleStore: create(() => ({ restoreStatus: 'complete' })) };
});
jest.mock('@/shared/stores/profile/nutDropRedeemQueueStore', () => ({
  useNutDropRedeemQueueStore: {
    getState: () => ({ byTokenHash: {} }),
    persist: {
      hasHydrated: () => mockHydrated,
      onHydrate: () => () => undefined,
      onFinishHydration: (listener: () => void) => {
        mockHydrationListeners.add(listener);
        return () => mockHydrationListeners.delete(listener);
      },
    },
  },
}));
jest.mock('@/features/payments/lib/parkedMessageEcash', () => ({
  hasDrainableMessageEcash: () => mockQueueHasWork,
  nextMessageEcashRetryAt: () => mockRetryAt,
  hasDueMessageEcash: () => mockDue,
}));
jest.mock('@/shared/providers/OfflineProvider', () => ({
  useOfflineStatus: () => ({ isOffline: false }),
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (select: (state: { mockMode: boolean }) => unknown) =>
    select({ mockMode: false }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A page of envelopes `ids`, each one second older than the last. */
function page(ids: string[], newestSec: number, hasNextPage: boolean): DmEnvelopePage {
  return {
    hasNextPage,
    envelopes: ids.map((id, index) => ({
      id,
      pubkey: 'c'.repeat(64),
      kind: 1059,
      createdAt: newestSec - index,
      content: '',
      tags: [],
    })),
  };
}

let renderer: TestRenderer.ReactTestRenderer;
let foreground: (() => void) | undefined;

async function settle() {
  await act(async () => {
    for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
  });
}

async function mount() {
  await act(async () => {
    renderer = TestRenderer.create(<DmEcashAutoRedeemProvider>{null}</DmEcashAutoRedeemProvider>);
  });
  await settle();
}

async function returnToForeground() {
  act(() => foreground?.());
  await settle();
}

const requestedUntil = () =>
  mockFetch.mock.calls.map(([params]) => (params as { until?: number }).until);

beforeEach(() => {
  // Page timestamps below are small numbers: far in the past, well outside
  // the gift-wrap backdating window, unless a test says otherwise.
  mockFetch.mockReset();
  mockDrain.mockClear();
  mockIntake.mockReset().mockResolvedValue('not-a-token');
  mockLive = undefined;
  mockQueueHasWork = false;
  mockActiveProfile = 'a'.repeat(64);
  mockHydrated = true;
  mockRetryAt = null;
  mockDue = false;
  mockHydrationListeners.clear();
  useWalletLifecycleStore.setState({ restoreStatus: 'complete' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    foreground = () => listener('active');
    return { remove: jest.fn() };
  });
});
afterEach(() => {
  act(() => renderer?.unmount());
  jest.restoreAllMocks();
});

describe('reading the message inbox for ecash', () => {
  it('walks back page by page until the inbox ends', async () => {
    mockFetch
      .mockResolvedValueOnce(page(['a', 'b'], 1000, true))
      .mockResolvedValueOnce(page(['c', 'd'], 900, true))
      .mockResolvedValueOnce(page(['e'], 800, false));
    await mount();
    expect(requestedUntil()).toEqual([undefined, 1000, 900]);
    expect(mockIntake.mock.calls.flat()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('redeems what a page brought even when the next page cannot be read', async () => {
    mockIntake.mockResolvedValueOnce('queued');
    mockFetch
      .mockResolvedValueOnce(page(['a'], 1000, true))
      .mockRejectedValueOnce(new Error('relay down'));
    await mount();
    expect(mockDrain).toHaveBeenCalledTimes(1);
  });

  it('starts every pass at the newest message and rereads what a failed pass never reached', async () => {
    mockFetch
      .mockResolvedValueOnce(page(['a'], 1000, true))
      .mockRejectedValueOnce(new Error('relay down'));
    await mount();

    mockFetch
      .mockResolvedValueOnce(page(['a'], 1000, true))
      .mockResolvedValueOnce(page(['b'], 900, false));
    await returnToForeground();
    // No `until` carried over from the failed pass, and an unchanged first
    // page did not end the walk: the inbox had never been read to its end.
    expect(requestedUntil()).toEqual([undefined, 1001, undefined, 1001]);
    expect(mockIntake.mock.calls.flat()).toContain('b');
  });

  it('stops at the first page with nothing new once the inbox has been read to its end', async () => {
    mockFetch.mockResolvedValueOnce(page(['a', 'b'], 1000, false));
    await mount();
    mockFetch.mockResolvedValue(page(['a', 'b'], 1000, true));
    await returnToForeground();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps reading while pages still hold messages that arrived in the meantime', async () => {
    mockFetch.mockResolvedValueOnce(page(['a'], 1000, false));
    await mount();
    mockFetch
      .mockResolvedValueOnce(page(['z', 'y'], 2000, true))
      .mockResolvedValueOnce(page(['x', 'a'], 1500, true))
      .mockResolvedValue(page(['a'], 1000, true));
    await returnToForeground();
    expect(mockIntake.mock.calls.flat()).toEqual(expect.arrayContaining(['z', 'y', 'x']));
    // Initial pass, then three pages: the third holds nothing new and ends it.
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('drains a live arrival that queued a token', async () => {
    mockFetch.mockResolvedValue(page([], 0, false));
    await mount();
    mockIntake.mockResolvedValueOnce('queued');
    act(() => mockLive?.(page(['live'], 3000, false)));
    await settle();
    expect(mockDrain).toHaveBeenCalledTimes(1);
  });

  it('serves the queue when a pending wallet restore settles', async () => {
    useWalletLifecycleStore.setState({ restoreStatus: 'pending' });
    mockFetch.mockResolvedValue(page([], 0, false));
    await mount();
    mockQueueHasWork = true;
    expect(mockDrain).not.toHaveBeenCalled();
    act(() => {
      useWalletLifecycleStore.setState({ restoreStatus: 'complete' });
    });
    await settle();
    expect(mockDrain).toHaveBeenCalledTimes(1);
  });

  it('stops when the transport ignores the cursor and returns the same inbox again', async () => {
    // The relay tier answers every request with the whole inbox.
    mockFetch.mockResolvedValue(page(['a', 'b'], 1000, true));
    await mount();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockIntake).toHaveBeenCalledTimes(4);
  });

  it('handles a live arrival between history pages, not after them', async () => {
    let releaseSecondPage: (value: DmEnvelopePage) => void = () => undefined;
    mockFetch
      .mockResolvedValueOnce(page(['a'], 1000, true))
      .mockImplementationOnce(
        () =>
          new Promise<DmEnvelopePage>((resolve) => {
            releaseSecondPage = resolve;
          })
      )
      .mockResolvedValueOnce(page(['c'], 800, false));
    await mount();
    // The walk is waiting on page two. A payment arrives.
    act(() => mockLive?.(page(['live'], 3000, false)));
    await act(async () => {
      releaseSecondPage(page(['b'], 900, true));
    });
    await settle();
    expect(mockIntake.mock.calls.flat()).toEqual(['a', 'b', 'live', 'c']);
  });

  it('reads back through the gift-wrap backdating window before a known page ends a walk', async () => {
    // A wrap delivered just now can be dated two days ago and so sit below
    // messages this session has already read.
    const nowSec = Math.floor(Date.now() / 1000);
    mockFetch
      .mockResolvedValueOnce(page(['a'], nowSec - 60, true))
      .mockResolvedValueOnce(page(['old'], 1000, false));
    await mount();

    mockFetch
      .mockResolvedValueOnce(page(['a'], nowSec - 60, true))
      .mockResolvedValueOnce(page(['backdated'], nowSec - 86_400, true))
      .mockResolvedValue(page(['old'], 1000, true));
    await returnToForeground();
    expect(mockIntake.mock.calls.flat()).toContain('backdated');
  });

  it('reads on past a message whose token cannot be handled', async () => {
    // For example a token naming a mint URL the wallet refuses to parse.
    mockIntake.mockRejectedValueOnce(new Error('Invalid mint URL')).mockResolvedValueOnce('queued');
    mockFetch
      .mockResolvedValueOnce(page(['bad', 'good'], 1000, true))
      .mockResolvedValueOnce(page(['older'], 900, false));
    await mount();
    expect(mockIntake.mock.calls.flat()).toEqual(['bad', 'good', 'older']);
    expect(mockDrain).toHaveBeenCalledTimes(1);
  });

  it('reads nothing until the stored queue has loaded', async () => {
    // Queuing into the empty default would overwrite the stored queue, and
    // the token would then be dropped when the stored map arrives.
    mockHydrated = false;
    mockFetch.mockResolvedValue(page(['a'], 1000, false));
    await mount();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockLive).toBeUndefined();

    mockHydrated = true;
    act(() => mockHydrationListeners.forEach((listener) => listener()));
    await settle();
    expect(mockIntake.mock.calls.flat()).toEqual(['a']);
  });

  it('wakes for a backed-off retry while the app stays open', async () => {
    jest.useFakeTimers();
    try {
      mockFetch.mockResolvedValue(page([], 0, false));
      mockRetryAt = Date.now() + 30_000;
      mockQueueHasWork = true;
      await mount();
      const drainsBefore = mockDrain.mock.calls.length;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(31_000);
      });
      expect(mockDrain.mock.calls.length).toBeGreaterThan(drainsBefore);
    } finally {
      jest.useRealTimers();
    }
  });

  it('looks again quickly a few times when a drain leaves due work, then keeps looking slowly', async () => {
    // The drainer returns at once when another drain is running, and that
    // drain may never have seen this token.
    jest.useFakeTimers();
    try {
      mockFetch.mockResolvedValue(page([], 0, false));
      mockQueueHasWork = true;
      mockDue = true;
      await mount();
      const first = mockDrain.mock.calls.length;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(7_000);
      });
      expect(mockDrain.mock.calls.length - first).toBe(3);
      // The drain in the way may be a long one: it never goes quiet.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(61_000);
      });
      expect(mockDrain.mock.calls.length - first).toBe(5);
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops writing once the profile has been deleted, even while still mounted', async () => {
    // Delete All clears the profiles before the runtime restarts. A token
    // filed then would land in unscoped storage and undo the wipe.
    mockStillCurrent.length = 0;
    mockActiveProfile = undefined;
    mockFetch.mockResolvedValue(page(['a'], 1000, false));
    await mount();
    expect(mockStillCurrent).toEqual([false]);
  });
});
