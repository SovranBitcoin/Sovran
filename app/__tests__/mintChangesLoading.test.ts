import { act, renderHook } from '@testing-library/react-native';
import { err, ok } from 'neverthrow';
import { useMintChangeRevisions } from '@/features/mint/hooks/useMintChanges';
import { MINT_CHANGES_CACHE_KEY, mintChangesCache } from '@/features/mint/data/mintChangesCache';
import { fetchMintChanges, type MintChangesResponse } from '@/shared/lib/apiClient';

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));
jest.mock('@cashu/coco-react', () => ({ useMints: () => ({ trustedMints: [] }) }));
// A REAL query-cache store (in-memory) so the hook's cache/generation contract is exercised.
jest.mock('@/features/mint/data/mintChangesCache', () => {
  const { createQueryCacheStore } = jest.requireActual<
    typeof import('@/shared/lib/cache/createQueryCacheStore')
  >('@/shared/lib/cache/createQueryCacheStore');
  return {
    MINT_CHANGES_CACHE_KEY: 'global',
    mintChangesCache: createQueryCacheStore({
      name: 'mint-changes-cache-test',
      staleTtlMs: 30 * 60 * 1000,
      persist: false,
      hostScoped: true,
    }),
  };
});
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/lib/apiClient', () => ({ fetchMintChanges: jest.fn() }));
jest.mock('@/shared/stores/global/mintMetadataStore', () => ({
  useMintMetadataStore: () => ({}),
}));
jest.mock('@/shared/lib/url', () => ({
  normalizeMintUrlKey: (url: string) => url.replace(/\/$/, '').toLowerCase(),
}));
jest.mock('@/shared/lib/errors', () => ({
  describeError: () => ({ text: 'Could not load updates.' }),
}));
// Created inside the factory (jest.mock is hoisted above any const in this file).
jest.mock('@/shared/lib/logger', () => {
  const sink = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
  return {
    log: { ...sink, child: () => sink },
    storeLog: sink,
    cashuLog: sink,
    monotonicNow: () => Date.now(),
    __sink: sink,
  };
});
const mockLog = (
  jest.requireMock('@/shared/lib/logger') as {
    __sink: Record<'info' | 'warn' | 'debug', jest.Mock>;
  }
).__sink;

const response: MintChangesResponse = {
  trackedMints: 1,
  reachableMints: 1,
  totalChanges: 1,
  changes: [
    {
      mintUrl: 'https://mint.sovran.money',
      name: 'Sovran Mint',
      at: 1_788_896_456,
      hash: 'revision',
      patch: [{ op: 'add', path: '/motd', value: 'A public update' }],
    },
  ],
};
beforeEach(() => {
  mintChangesCache.clear();
  jest.clearAllMocks();
});
it('fetches a cold detail deep link without mounting the notifications list', async () => {
  type FetchResult = Awaited<ReturnType<typeof fetchMintChanges>>;
  let resolve!: (result: FetchResult) => void;
  jest.mocked(fetchMintChanges).mockReturnValueOnce(
    new Promise<FetchResult>((done) => {
      resolve = done;
    })
  );
  const { result } = renderHook(() => useMintChangeRevisions('https://mint.sovran.money'));
  await act(async () => {});
  expect(result.current.isLoading).toBe(true);
  expect(result.current.revisions).toEqual([]);
  expect(fetchMintChanges).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolve(ok(response) as FetchResult);
  });
  expect(result.current.isLoading).toBe(false);
  expect(result.current.revisions[0].entry.name).toBe('Sovran Mint');
  const done = mockLog.info.mock.calls.find(([event]) => event === 'read.mintChanges.done');
  expect(done?.[1]).toMatchObject({ source: 'network', count: 1 });
});
it('reuses a fresh list cache on detail navigation with zero round-trips', async () => {
  mintChangesCache.setEntry(MINT_CHANGES_CACHE_KEY, response, { viewerKey: '' });
  const { result } = renderHook(() => useMintChangeRevisions('https://mint.sovran.money/'));
  await act(async () => {});
  expect(result.current.revisions).toHaveLength(1);
  expect(result.current.isLoading).toBe(false);
  expect(fetchMintChanges).not.toHaveBeenCalled();
  const request = mockLog.info.mock.calls.find(([event]) => event === 'read.mintChanges.request');
  expect(request?.[1]).toMatchObject({ action: 'serve-fresh', cached: true });
});
it('paints a stale cached list immediately and revalidates in the background', async () => {
  mintChangesCache.useCacheState.setState({
    byKey: { [MINT_CHANGES_CACHE_KEY]: { data: response, fetchedAt: 0, viewerKey: '' } },
  });
  jest.mocked(fetchMintChanges).mockImplementation(() => new Promise(() => {}));
  const { result } = renderHook(() => useMintChangeRevisions('https://mint.sovran.money'));
  await act(async () => {});
  expect(result.current.revisions).toHaveLength(1);
  expect(result.current.isLoading).toBe(false);
  expect(result.current.isRefreshing).toBe(false); // background revalidate, not a pull-to-refresh
  expect(fetchMintChanges).toHaveBeenCalledTimes(1);
});
it('distinguishes failure from empty history and supports retry', async () => {
  jest
    .mocked(fetchMintChanges)
    .mockResolvedValueOnce(err(new Error('offline')))
    .mockResolvedValueOnce(ok(response));
  const { result } = renderHook(() => useMintChangeRevisions('https://mint.sovran.money'));
  await act(async () => {});
  expect(result.current.errorMessage).toBe('Could not load updates.');
  expect(result.current.isLoading).toBe(false);
  await act(async () => {
    result.current.refresh();
  });
  expect(result.current.errorMessage).toBeNull();
  expect(result.current.revisions).toHaveLength(1);
});
it('aborts the detail read when leaving the screen', async () => {
  jest.mocked(fetchMintChanges).mockImplementation(() => new Promise(() => {}));
  const { unmount } = renderHook(() => useMintChangeRevisions('https://mint.sovran.money'));
  await act(async () => {});
  const signal = jest.mocked(fetchMintChanges).mock.calls[0][0]?.signal;
  unmount();
  expect(signal?.aborted).toBe(true);
});
