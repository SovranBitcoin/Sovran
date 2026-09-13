import { act, renderHook } from '@testing-library/react-native';

import {
  useNotificationsPage,
  useNotificationFollowersPage,
} from '@/features/feed/hooks/useNotificationsPage';
import {
  notificationsPageCache,
  notificationsPageKey,
} from '@/features/feed/data/notificationsCache';
import {
  notificationFollowersCache,
  notificationFollowersKey,
} from '@/features/feed/data/notificationFollowersCache';
import { emptyNotificationsResult } from '@/features/feed/lib/notificationResults';
import type { FeedNotification, FeedNotificationsResult } from '@/features/feed/data/feedClient';

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));
jest.mock('@/shared/lib/logger', () => {
  const sink = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  return {
    log: { ...sink, child: () => sink },
    storeLog: sink,
    feedLog: sink,
    monotonicNow: () => Date.now(),
  };
});
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/lib/errors', () => ({
  describeError: () => ({ id: 'x', text: 'Could not load notifications.' }),
}));

const mockGetNotifications = jest.fn();
const mockOpenSession = jest.fn();
jest.mock('@/features/feed/data/useFeedClient', () => ({
  getFeedClient: () => ({
    getNotifications: (...args: unknown[]) => mockGetNotifications(...args),
    openNotificationsSession: (...args: unknown[]) => mockOpenSession(...args),
    dispose: jest.fn(),
  }),
}));

const VIEWER = 'v'.repeat(64);
const notif = (id: string, reason = 'reaction'): FeedNotification =>
  ({
    type: 'single',
    reason,
    event: { id, pubkey: 'a'.repeat(64), kind: 7, content: '', tags: [], created_at: 100 },
  }) as unknown as FeedNotification;
const pageOf = (ids: string[], paginationUntil = 0): FeedNotificationsResult => ({
  ...emptyNotificationsResult(),
  notifications: ids.map((id) => notif(id)),
  paginationUntil,
  hasNextPage: paginationUntil > 0,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeSession(firstPage: Promise<FeedNotificationsResult>, more?: FeedNotificationsResult) {
  const listeners = new Set<() => void>();
  let snapshot = emptyNotificationsResult();
  const session = {
    firstPage: async () => {
      snapshot = await firstPage;
      return snapshot;
    },
    loadMore: async () => {
      snapshot = more ?? snapshot;
      return snapshot;
    },
    snapshot: () => snapshot,
    hasMore: () => !!more,
    pendingCount: () => 0,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: jest.fn(),
    emit: (next: FeedNotificationsResult) => {
      snapshot = next;
      for (const l of listeners) l();
    },
  };
  return session;
}

const base = {
  viewerPubkey: VIEWER,
  policy: 'MODERATE' as const,
  replyScope: 'DIRECT' as const,
  ownEventIds: [] as string[],
  enabled: true,
};
const flush = () => act(async () => {});

beforeEach(() => {
  notificationsPageCache.clear();
  notificationFollowersCache.clear();
  jest.clearAllMocks();
});

describe('useNotificationsPage', () => {
  it('a tab switch to a cached tab paints that tab synchronously — never null', async () => {
    const allKey = notificationsPageKey({
      viewerPubkey: VIEWER,
      tab: 'ALL',
      policy: 'MODERATE',
      replyScope: 'DIRECT',
    });
    const mentionsKey = notificationsPageKey({
      viewerPubkey: VIEWER,
      tab: 'MENTIONS',
      policy: 'MODERATE',
      replyScope: 'DIRECT',
    });
    notificationsPageCache.setEntry(allKey, pageOf(['a1']), { viewerKey: VIEWER });
    notificationsPageCache.setEntry(mentionsKey, pageOf(['m1']), { viewerKey: VIEWER });
    const { result, rerender } = renderHook(
      ({ tab }: { tab: 'ALL' | 'MENTIONS' }) => useNotificationsPage({ ...base, tab }),
      { initialProps: { tab: 'ALL' } }
    );
    await flush();
    expect(result.current.result?.notifications.map((n) => n.event.id)).toEqual(['a1']);
    expect(result.current.isInitialLoading).toBe(false);
    rerender({ tab: 'MENTIONS' });
    expect(result.current.result?.notifications.map((n) => n.event.id)).toEqual(['m1']);
    expect(result.current.isInitialLoading).toBe(false);
    await flush();
    expect(mockOpenSession).not.toHaveBeenCalled();
  });

  it('a cold tab is initial-loading with no rows, then the session first page lands and caches', async () => {
    const first = deferred<FeedNotificationsResult>();
    const session = fakeSession(first.promise);
    mockOpenSession.mockReturnValue(session);
    const { result } = renderHook(() => useNotificationsPage({ ...base, tab: 'ALL' }));
    await flush();
    expect(result.current.isInitialLoading).toBe(true);
    expect(result.current.result).toBeNull();
    await act(async () => {
      first.resolve(pageOf(['n1', 'n2'], 50));
    });
    expect(result.current.isInitialLoading).toBe(false);
    expect(result.current.result?.notifications).toHaveLength(2);
    const key = notificationsPageKey({
      viewerPubkey: VIEWER,
      tab: 'ALL',
      policy: 'MODERATE',
      replyScope: 'DIRECT',
    });
    expect(notificationsPageCache.getEntry(key)?.data.notifications).toHaveLength(2);
  });

  it('session in-place updates re-write the cached page; a refresh failure keeps the rows', async () => {
    const first = deferred<FeedNotificationsResult>();
    const session = fakeSession(first.promise);
    mockOpenSession.mockReturnValue(session);
    const { result } = renderHook(() => useNotificationsPage({ ...base, tab: 'ALL' }));
    await flush();
    await act(async () => {
      first.resolve(pageOf(['n1']));
    });
    act(() => session.emit(pageOf(['n1', 'n2'])));
    await flush();
    expect(result.current.result?.notifications).toHaveLength(2);

    // Refresh fails: rows stay, error is reported.
    mockOpenSession.mockReturnValue(null);
    mockGetNotifications.mockRejectedValue(new Error('offline'));
    await act(async () => {
      result.current.refresh();
    });
    expect(result.current.result?.notifications).toHaveLength(2);
    expect(result.current.errorMessage).toBe('Could not load notifications.');
    expect(result.current.isInitialLoading).toBe(false);
  });

  it('an unavailable first answer is an error, not an empty tab', async () => {
    mockOpenSession.mockReturnValue(null);
    mockGetNotifications.mockResolvedValue({
      ...emptyNotificationsResult(),
      read: { status: 'unavailable', sources: [], attempts: ['nagg=failed'], degraded: true },
    });
    const { result } = renderHook(() => useNotificationsPage({ ...base, tab: 'ALL' }));
    await flush();
    expect(result.current.errorMessage).toBe('Could not load notifications.');
    expect(result.current.result).toBeNull();
    expect(result.current.isInitialLoading).toBe(false);
  });

  it('load more appends through the session and survives in-place updates', async () => {
    const first = deferred<FeedNotificationsResult>();
    const session = fakeSession(first.promise, pageOf(['n1', 'n2', 'n3']));
    mockOpenSession.mockReturnValue(session);
    const { result } = renderHook(() => useNotificationsPage({ ...base, tab: 'ALL' }));
    await flush();
    await act(async () => {
      first.resolve(pageOf(['n1']));
    });
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.result?.notifications).toHaveLength(3);
    act(() => session.emit(pageOf(['n1', 'n2', 'n3'])));
    await flush();
    expect(result.current.result?.notifications).toHaveLength(3);
  });

  it('disabled (client tab / demo) never reads and is not loading', async () => {
    const { result } = renderHook(() =>
      useNotificationsPage({ ...base, tab: 'ALL', enabled: false })
    );
    await flush();
    expect(result.current.isInitialLoading).toBe(false);
    expect(result.current.result).toBeNull();
    expect(mockOpenSession).not.toHaveBeenCalled();
  });
});

describe('useNotificationFollowersPage', () => {
  it('a hand-over seed paints immediately and costs no round-trip', async () => {
    const seed = pageOf(['f1', 'f2'], 40);
    const { result } = renderHook(() =>
      useNotificationFollowersPage({
        viewerPubkey: VIEWER,
        policy: 'MODERATE',
        replyScope: 'DIRECT',
        seed,
      })
    );
    await flush();
    expect(result.current.result?.notifications).toHaveLength(2);
    expect(result.current.isInitialLoading).toBe(false);
    expect(mockGetNotifications).not.toHaveBeenCalled();
    expect(
      notificationFollowersCache.getEntry(notificationFollowersKey(VIEWER))?.data.notifications
    ).toHaveLength(2);
  });

  it('without a seed it walks the ALL tab keeping only follows', async () => {
    mockGetNotifications.mockResolvedValueOnce({
      ...pageOf(['x1'], 10),
      notifications: [notif('x1', 'reaction'), notif('f1', 'follow')],
    });
    const { result } = renderHook(() =>
      useNotificationFollowersPage({
        viewerPubkey: VIEWER,
        policy: 'MODERATE',
        replyScope: 'DIRECT',
        seed: undefined,
      })
    );
    await flush();
    expect(result.current.result?.notifications.map((n) => n.event.id)).toEqual(['f1']);
    expect(mockGetNotifications.mock.calls[0][0]).toMatchObject({ tab: 'ALL', grouped: false });
  });
});
