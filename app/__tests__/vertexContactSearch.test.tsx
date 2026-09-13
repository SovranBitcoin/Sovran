import { act, renderHook } from '@testing-library/react-native';
import { err, ok, type Result } from 'neverthrow';
import type { SearchUsersResponse } from '@sovranbitcoin/schemas';
import { SEARCH_DEBOUNCE_MS, useContactSearch } from '@/features/payments/hooks/useContactSearch';
import { profileSearchCache } from '@/features/payments/data/profileSearchCache';

const mockSearch = jest.fn();
jest.mock('@nostr-dev-kit/ndk-mobile', () => ({ useNDK: () => ({ ndk: undefined }) }), {
  virtual: true,
});
jest.mock('@/shared/lib/nostr/searchProfiles', () => ({
  searchProfilesViaFacade: (...args: unknown[]) => mockSearch(...args),
}));
jest.mock('@/shared/lib/logger', () => {
  const sink = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  return {
    log: { ...sink, child: () => sink },
    storeLog: sink,
    paymentLog: sink,
    monotonicNow: () => Date.now(),
    redactError: jest.fn(),
  };
});
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));
jest.mock('@/shared/lib/nostr/useEntityCache', () => ({ seedLowConfidenceProfiles: jest.fn() }));

const response = (query: string, pubkeys: string[]): SearchUsersResponse => ({
  query,
  limit: 10,
  sort: 'facade:nagg',
  fromCache: false,
  results: pubkeys.map((pubkey) => ({ pubkey, npub: `npub${pubkey}`, name: pubkey })),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.useFakeTimers();
  profileSearchCache.clear();
  mockSearch.mockReset().mockImplementation(() => new Promise(() => {}));
});
afterEach(() => {
  jest.useRealTimers();
});

const settle = () => act(async () => {});

it('debounces the normalized query and does NOT cancel the in-flight request on a keystroke inside the window', async () => {
  const { rerender } = renderHook(({ query }: { query: string }) => useContactSearch(query), {
    initialProps: { query: '' },
  });
  rerender({ query: ' ALICE ' });
  await act(async () => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
  });
  expect(mockSearch).not.toHaveBeenCalled();
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(mockSearch).toHaveBeenCalledTimes(1);
  expect(mockSearch.mock.calls[0][0].query).toBe('alice');
  const signal = mockSearch.mock.calls[0][0].signal as AbortSignal;

  // A keystroke that settles back to the same query inside the window is a no-op.
  rerender({ query: 'alic' });
  rerender({ query: ' ALICE ' });
  await act(async () => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  });
  expect(signal.aborted).toBe(false);
  expect(mockSearch).toHaveBeenCalledTimes(1);
});

it('keeps the previous rows on screen (revalidating) while a refinement loads', async () => {
  const first = deferred<Result<SearchUsersResponse, Error>>();
  mockSearch
    .mockImplementationOnce(() => first.promise)
    .mockImplementation(() => new Promise(() => {}));
  const { result, rerender } = renderHook(
    ({ query }: { query: string }) => useContactSearch(query),
    {
      initialProps: { query: 'ali' },
    }
  );
  await act(async () => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  });
  await act(async () => {
    first.resolve(ok(response('ali', ['a1', 'a2'])));
  });
  expect(result.current.status).toBe('ready');
  expect(result.current.results.map((r) => r.pubkey)).toEqual(['a1', 'a2']);

  rerender({ query: 'alic' });
  await act(async () => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  });
  expect(result.current.status).toBe('revalidating');
  expect(result.current.results.map((r) => r.pubkey)).toEqual(['a1', 'a2']);
});

it('drops an out-of-order answer: the superseded query cannot paint over the newer one', async () => {
  const first = deferred<Result<SearchUsersResponse, Error>>();
  const second = deferred<Result<SearchUsersResponse, Error>>();
  mockSearch
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise);
  const { result, rerender } = renderHook(
    ({ query }: { query: string }) => useContactSearch(query),
    {
      initialProps: { query: 'bob' },
    }
  );
  await act(async () => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  });
  rerender({ query: 'bobby' });
  await act(async () => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  });
  expect(mockSearch).toHaveBeenCalledTimes(2);
  await act(async () => {
    second.resolve(ok(response('bobby', ['b2'])));
  });
  await act(async () => {
    first.resolve(ok(response('bob', ['b1'])));
  });
  expect(result.current.results.map((r) => r.pubkey)).toEqual(['b2']);
  expect(result.current.status).toBe('ready');
});

it('a failed search is an error, not an empty result', async () => {
  mockSearch.mockImplementation(async () => err(new Error('profile search unavailable')));
  const { result } = renderHook(() => useContactSearch('carol'));
  await act(async () => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  });
  await settle();
  expect(result.current.status).toBe('error');
  expect(result.current.results).toEqual([]);
  expect(result.current.error).toBeInstanceOf(Error);
});

it('a healthy empty answer is empty', async () => {
  mockSearch.mockImplementation(async () => ok(response('nobody', [])));
  const { result } = renderHook(() => useContactSearch('nobody'));
  await act(async () => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  });
  await settle();
  expect(result.current.status).toBe('empty');
});

it('a query below the minimum is idle: no request, no placeholders', async () => {
  const { result } = renderHook(() => useContactSearch('al'));
  await act(async () => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
  });
  expect(mockSearch).not.toHaveBeenCalled();
  expect(result.current.status).toBe('idle');
  expect(result.current.hasSearched).toBe(false);
});

it('a query searched earlier this session paints from cache with no request', async () => {
  mockSearch.mockImplementation(async () => ok(response('dave', ['d1'])));
  const { result, rerender } = renderHook(
    ({ query }: { query: string }) => useContactSearch(query),
    {
      initialProps: { query: 'dave' },
    }
  );
  await act(async () => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  });
  await settle();
  expect(mockSearch).toHaveBeenCalledTimes(1);
  rerender({ query: 'da' });
  await settle();
  rerender({ query: 'dave' });
  await act(async () => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  });
  await settle();
  expect(mockSearch).toHaveBeenCalledTimes(1);
  expect(result.current.status).toBe('ready');
  expect(result.current.results.map((r) => r.pubkey)).toEqual(['d1']);
});

it('a partial (first-tier / pre-Vertex) answer paints immediately and is upgraded in place', async () => {
  let onCached!: (data: SearchUsersResponse) => void;
  const final = deferred<Result<SearchUsersResponse, Error>>();
  mockSearch.mockImplementation((args: { onCached: (d: SearchUsersResponse) => void }) => {
    onCached = args.onCached;
    return final.promise;
  });
  const { result } = renderHook(() => useContactSearch('erin'));
  await act(async () => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  });
  act(() => onCached(response('erin', ['e1'])));
  await settle();
  expect(result.current.results.map((r) => r.pubkey)).toEqual(['e1']);
  expect(result.current.partial).toBe(true);
  await act(async () => {
    final.resolve(ok(response('erin', ['e1', 'e2'])));
  });
  expect(result.current.results.map((r) => r.pubkey)).toEqual(['e1', 'e2']);
  expect(result.current.partial).toBe(false);
});
