import { act, renderHook } from '@testing-library/react-native';
import { err, ok } from 'neverthrow';
import { useMintChangeRevisions } from '@/features/mint/hooks/useMintChanges';
import { fetchMintChanges, type MintChangesResponse } from '@/shared/lib/apiClient';

let mockCached: MintChangesResponse | undefined;
let mockFresh = false;
const mockRun = jest.fn(
  async (_key: string, factory: () => Promise<{ data: MintChangesResponse }>) => {
    const { data } = await factory();
    mockCached = data;
    return data;
  }
);
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));
jest.mock('@cashu/coco-react', () => ({ useMints: () => ({ trustedMints: [] }) }));
jest.mock('@/features/mint/data/mintChangesCache', () => ({
  MINT_CHANGES_CACHE_KEY: 'global',
  mintChangesCache: {
    use: () => mockCached,
    getEntry: () => (mockCached ? { data: mockCached } : undefined),
    isFresh: () => mockFresh,
    run: (...args: Parameters<typeof mockRun>) => mockRun(...args),
  },
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
jest.mock('@/shared/lib/logger', () => ({ cashuLog: { info: jest.fn(), warn: jest.fn() } }));

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
  mockCached = undefined;
  mockFresh = false;
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
  expect(result.current.isLoading).toBe(true);
  expect(result.current.revisions).toEqual([]);
  expect(fetchMintChanges).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolve(ok(response) as FetchResult);
  });
  expect(result.current.isLoading).toBe(false);
  expect(result.current.revisions[0].entry.name).toBe('Sovran Mint');
});
it('reuses a fresh list cache on detail navigation', async () => {
  mockCached = response;
  mockFresh = true;
  const { result } = renderHook(() => useMintChangeRevisions('https://mint.sovran.money/'));
  await act(async () => {});
  expect(result.current.revisions).toHaveLength(1);
  expect(fetchMintChanges).not.toHaveBeenCalled();
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
it('aborts the detail read when leaving the screen', () => {
  jest.mocked(fetchMintChanges).mockImplementation(() => new Promise(() => {}));
  const { unmount } = renderHook(() => useMintChangeRevisions('https://mint.sovran.money'));
  const signal = jest.mocked(fetchMintChanges).mock.calls[0][0]?.signal;
  unmount();
  expect(signal?.aborted).toBe(true);
});
