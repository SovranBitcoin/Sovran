import { act, renderHook } from '@testing-library/react-native';

import { createQueryCacheStore } from '@/shared/lib/cache/createQueryCacheStore';
import { useCachedRead } from '@/shared/lib/read/useCachedRead';

// Created inside the factory (jest.mock is hoisted above any const in this file).
jest.mock('@/shared/lib/logger', () => {
  const readLog = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
  return {
    log: { child: () => readLog, info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    monotonicNow: () => Date.now(),
    storeLog: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    __readLog: readLog,
  };
});
const mockReadLog = (
  jest.requireMock('@/shared/lib/logger') as {
    __readLog: Record<'info' | 'warn' | 'debug', jest.Mock>;
  }
).__readLog;
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
// Focus effects run as plain effects in tests (same seam mintChangesLoading uses).
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));

type Page = { items: string[]; read?: { status: 'ok' | 'unavailable' } };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let seq = 0;
function makeStore(staleTtlMs = 60_000) {
  seq += 1;
  return createQueryCacheStore<Page>({ name: `read-test-${seq}`, staleTtlMs, persist: false });
}

const flush = () => act(async () => {});

function events(kind: 'info' | 'debug' | 'warn') {
  return mockReadLog[kind].mock.calls.map(([event, params]) => ({ event, params }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useCachedRead', () => {
  it('a fresh entry serves with zero round-trips and logs serve-fresh', async () => {
    const store = makeStore();
    store.setEntry('k', { items: ['a'] }, { viewerKey: 'v' });
    const fetcher = jest.fn();
    const { result } = renderHook(() =>
      useCachedRead<Page>({ store, surface: 'mintChanges', key: 'k', viewerKey: 'v', fetcher })
    );
    await flush();
    expect(result.current.status).toBe('ready');
    expect(result.current.data?.items).toEqual(['a']);
    expect(fetcher).not.toHaveBeenCalled();
    const request = events('info').find((e) => e.event === 'read.mintChanges.request');
    expect(request?.params).toMatchObject({
      action: 'serve-fresh',
      cached: true,
      stale: false,
      trigger: 'mount',
    });
  });

  it('a stale entry paints immediately as revalidating, then settles ready', async () => {
    const store = makeStore(0);
    store.setEntry('k', { items: ['old'] }, { viewerKey: 'v' });
    const fetch = deferred<{ data: Page }>();
    const { result } = renderHook(() =>
      useCachedRead<Page>({
        store,
        surface: 'mintChanges',
        key: 'k',
        viewerKey: 'v',
        fetcher: () => fetch.promise,
      })
    );
    await flush();
    expect(result.current.status).toBe('revalidating');
    expect(result.current.data?.items).toEqual(['old']);
    expect(result.current.source).toBe('cache');
    await act(async () => {
      fetch.resolve({ data: { items: ['new'] } });
    });
    // Data updated to fresh; the 0ms TTL makes it "stale" again immediately but the read is settled.
    expect(result.current.data?.items).toEqual(['new']);
    expect(result.current.isFetching).toBe(false);
  });

  it('a miss shows loading with no data, then ready', async () => {
    const store = makeStore();
    const fetch = deferred<{ data: Page }>();
    const { result } = renderHook(() =>
      useCachedRead<Page>({
        store,
        surface: 'mintChanges',
        key: 'k',
        viewerKey: 'v',
        fetcher: () => fetch.promise,
      })
    );
    await flush();
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeUndefined();
    await act(async () => {
      fetch.resolve({ data: { items: ['x'] } });
    });
    expect(result.current.status).toBe('ready');
    const phases = events('debug')
      .filter((e) => e.event === 'read.mintChanges.render')
      .map((e) => e.params.phase);
    expect(phases).toEqual(['skeleton', 'populated']);
  });

  it('a key change to an uncached key never shows the previous data unless keepPreviousData says so', async () => {
    const store = makeStore();
    store.setEntry('a', { items: ['A'] }, { viewerKey: 'v' });
    const fetch = deferred<{ data: Page }>();
    const { result, rerender } = renderHook(
      ({ key, keep }: { key: string; keep: boolean }) =>
        useCachedRead<Page>({
          store,
          surface: 'notifications',
          key,
          viewerKey: 'v',
          fetcher: () => fetch.promise,
          keepPreviousData: keep ? () => true : undefined,
        }),
      { initialProps: { key: 'a', keep: false } }
    );
    await flush();
    expect(result.current.data?.items).toEqual(['A']);

    rerender({ key: 'b', keep: false });
    await flush();
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeUndefined();

    rerender({ key: 'b', keep: true });
    await flush();
    expect(result.current.status).toBe('revalidating');
    expect(result.current.data?.items).toEqual(['A']);
    const request = events('info')
      .filter((e) => e.event === 'read.notifications.request')
      .at(-1);
    expect(request?.params).toMatchObject({ trigger: 'key-change' });
  });

  it('a seed paints as revalidating from a prior step while the fetch runs', async () => {
    const store = makeStore();
    const fetch = deferred<{ data: Page }>();
    const { result } = renderHook(() =>
      useCachedRead<Page>({
        store,
        surface: 'profileFeed',
        key: 'k',
        viewerKey: 'v',
        fetcher: () => fetch.promise,
        seed: () => ({ items: ['seeded'] }),
      })
    );
    await flush();
    expect(result.current.status).toBe('revalidating');
    expect(result.current.source).toBe('seed');
    expect(result.current.data?.items).toEqual(['seeded']);
    await act(async () => {
      fetch.resolve({ data: { items: ['real'] } });
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.data?.items).toEqual(['real']);
  });

  it('refresh() supersedes the in-flight run; the stale result is never applied', async () => {
    const store = makeStore();
    const first = deferred<{ data: Page }>();
    const second = deferred<{ data: Page }>();
    let call = 0;
    const { result } = renderHook(() =>
      useCachedRead<Page>({
        store,
        surface: 'mintChanges',
        key: 'k',
        viewerKey: 'v',
        fetcher: () => (++call === 1 ? first.promise : second.promise),
      })
    );
    await flush();
    act(() => result.current.refresh());
    await flush();
    await act(async () => {
      second.resolve({ data: { items: ['second'] } });
    });
    await act(async () => {
      first.resolve({ data: { items: ['first'] } });
    });
    expect(result.current.data?.items).toEqual(['second']);
    expect(store.getEntry('k')?.data.items).toEqual(['second']);
    const superseded = events('debug').filter((e) => e.event === 'read.mintChanges.superseded');
    expect(superseded.length).toBeGreaterThanOrEqual(1);
  });

  it('a failure with retained data keeps it on screen; without data it is an error', async () => {
    const store = makeStore(0);
    store.setEntry('k', { items: ['kept'] }, { viewerKey: 'v' });
    const { result } = renderHook(() =>
      useCachedRead<Page>({
        store,
        surface: 'mintChanges',
        key: 'k',
        viewerKey: 'v',
        fetcher: () => Promise.reject(new Error('offline')),
      })
    );
    await flush();
    expect(result.current.data?.items).toEqual(['kept']);
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeInstanceOf(Error);
    const failed = events('warn').find((e) => e.event === 'read.mintChanges.failed');
    expect(failed?.params).toMatchObject({ retained: true, errorType: 'Error' });

    const empty = makeStore();
    const { result: r2 } = renderHook(() =>
      useCachedRead<Page>({
        store: empty,
        surface: 'mintChanges',
        key: 'k',
        viewerKey: 'v',
        fetcher: () => Promise.reject(new Error('offline')),
      })
    );
    await flush();
    expect(r2.current.status).toBe('error');
  });

  it('classify maps zero items to empty and an unavailable marker to error', async () => {
    const store = makeStore();
    store.setEntry('e', { items: [] }, { viewerKey: 'v' });
    store.setEntry('u', { items: [], read: { status: 'unavailable' } }, { viewerKey: 'v' });
    const classify = (page: Page) =>
      page.read?.status === 'unavailable' ? 'error' : page.items.length === 0 ? 'empty' : 'ready';
    const { result: e } = renderHook(() =>
      useCachedRead<Page>({
        store,
        surface: 'feed',
        key: 'e',
        viewerKey: 'v',
        fetcher: jest.fn(),
        classify,
      })
    );
    const { result: u } = renderHook(() =>
      useCachedRead<Page>({
        store,
        surface: 'feed',
        key: 'u',
        viewerKey: 'v',
        fetcher: jest.fn(),
        classify,
      })
    );
    await flush();
    expect(e.current.status).toBe('empty');
    expect(u.current.status).toBe('error');
  });

  it('an entry written for another viewer reads as absent', async () => {
    const store = makeStore();
    store.setEntry('k', { items: ['theirs'] }, { viewerKey: 'other' });
    const fetch = deferred<{ data: Page }>();
    const { result } = renderHook(() =>
      useCachedRead<Page>({
        store,
        surface: 'dmThread',
        key: 'k',
        viewerKey: 'me',
        fetcher: () => fetch.promise,
      })
    );
    await flush();
    expect(result.current.data).toBeUndefined();
    expect(result.current.status).toBe('loading');
  });

  it('partial() paints early data as revalidating+partial until the run completes', async () => {
    const store = makeStore();
    let partialFn!: (data: Page) => void;
    const fetch = deferred<{ data: Page }>();
    const { result } = renderHook(() =>
      useCachedRead<Page>({
        store,
        surface: 'searchProfiles',
        key: 'k',
        viewerKey: 'v',
        fetcher: (ctx) => {
          partialFn = ctx.partial;
          return fetch.promise;
        },
      })
    );
    await flush();
    act(() => partialFn({ items: ['early'] }));
    await flush();
    expect(result.current.data?.items).toEqual(['early']);
    expect(result.current.status).toBe('revalidating');
    expect(result.current.partial).toBe(true);
    await act(async () => {
      fetch.resolve({ data: { items: ['early', 'late'] } });
    });
    expect(result.current.partial).toBe(false);
    expect(result.current.status).toBe('ready');
  });

  it('a destructive seed is taken once per key, not once per render', async () => {
    const store = makeStore();
    const fetch = deferred<{ data: Page }>();
    let taken = 0;
    const { result, rerender } = renderHook(() =>
      useCachedRead<Page>({
        store,
        surface: 'followers',
        key: 'k',
        viewerKey: 'v',
        fetcher: () => fetch.promise,
        seed: () => {
          taken += 1;
          return taken === 1 ? { items: ['handed-over'] } : undefined;
        },
      })
    );
    await flush();
    rerender({});
    rerender({});
    expect(taken).toBe(1);
    expect(result.current.data?.items).toEqual(['handed-over']);
    expect(result.current.status).toBe('revalidating');
  });

  it('fetch context carries the read mode (refresh vs initial)', async () => {
    const store = makeStore();
    const modes: string[] = [];
    const { result } = renderHook(() =>
      useCachedRead<Page>({
        store,
        surface: 'mintChanges',
        key: 'k',
        viewerKey: 'v',
        fetcher: async ({ mode }) => {
          modes.push(mode);
          return { data: { items: ['x'] } };
        },
      })
    );
    await flush();
    await act(async () => {
      result.current.refresh();
    });
    expect(modes).toEqual(['initial', 'refresh']);
  });

  it('unmount aborts the in-flight run so nothing sets state afterwards', async () => {
    const store = makeStore();
    let signal: AbortSignal | undefined;
    const { unmount } = renderHook(() =>
      useCachedRead<Page>({
        store,
        surface: 'mintChanges',
        key: 'k',
        viewerKey: 'v',
        fetcher: (ctx) => {
          signal = ctx.signal;
          return new Promise(() => {});
        },
      })
    );
    await flush();
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
