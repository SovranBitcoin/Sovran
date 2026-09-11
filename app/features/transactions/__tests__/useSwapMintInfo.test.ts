import { act, renderHook } from '@testing-library/react-native';
import { useSwapMintInfo } from '../hooks/useSwapMintInfo';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';

const mockGetMintInfo = jest.fn();
const mockManager = { mint: { getMintInfo: mockGetMintInfo } };
jest.mock('@cashu/coco-react', () => ({ useManager: () => mockManager }));
jest.mock('@/features/mint', () => ({
  useMintManagement: () => ({ getMintInfo: mockGetMintInfo }),
}));
jest.mock('@/shared/lib/url', () => ({ normalizeMintUrlKey: (url: string) => url }));
jest.mock('@/shared/stores/global/mintMetadataStore', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  const store = create<{ byMintUrl: Record<string, { displayName?: string; iconUrl?: string }> }>(
    () => ({ byMintUrl: {} })
  );
  return {
    useMintMetadataStore: store,
    getCachedMintInfo: async (
      fetcher: (url: string) => Promise<{ name?: string; icon_url?: string }>,
      url: string
    ) => {
      const cached = store.getState().byMintUrl[url];
      if (cached) return { name: cached.displayName, icon_url: cached.iconUrl };
      const result = await fetcher(url);
      store.setState((state) => ({
        byMintUrl: {
          ...state.byMintUrl,
          [url]: { displayName: result.name, iconUrl: result.icon_url },
        },
      }));
      return result;
    },
  };
});

beforeEach(() => {
  mockGetMintInfo.mockReset().mockImplementation(() => new Promise(() => {}));
  useMintMetadataStore.setState({ byMintUrl: {} });
});

it('shows cached identity immediately while a different mint is unavailable', () => {
  useMintMetadataStore.setState({
    byMintUrl: { cached: { displayName: 'Cached mint', iconUrl: 'cached.png' } },
  });
  const urls = ['offline', 'cached'];
  const { result } = renderHook(() => useSwapMintInfo(urls));
  expect(result.current.cached).toEqual({ name: 'Cached mint', icon_url: 'cached.png' });
});

it('bounds cache misses and reveals each successful mint without waiting for a stalled peer', async () => {
  const finish = new Map<string, (info: { name: string }) => void>();
  mockGetMintInfo.mockImplementation(
    (url: string) => new Promise((resolve) => finish.set(url, resolve))
  );
  const urls = ['slow', 'fast', 'third', 'queued'];
  const { result } = renderHook(() => useSwapMintInfo(urls));
  expect(mockGetMintInfo.mock.calls.map(([url]) => url)).toEqual(['slow', 'fast', 'third']);

  await act(async () => finish.get('fast')!({ name: 'Fast mint' }));

  expect(result.current.fast?.name).toBe('Fast mint');
  expect(result.current.slow).toBeNull();
  expect(mockGetMintInfo.mock.calls.map(([url]) => url)).toEqual(urls);
});

it('ignores old-group identities and stops queued work after switching groups', async () => {
  const finish = new Map<string, (info: { name: string }) => void>();
  mockGetMintInfo.mockImplementation(
    (url: string) => new Promise((resolve) => finish.set(url, resolve))
  );
  const { result, rerender } = renderHook(({ urls }: { urls: string[] }) => useSwapMintInfo(urls), {
    initialProps: { urls: ['old', 'old-2', 'old-3', 'never-start'] },
  });
  rerender({ urls: ['current'] });
  await act(async () => finish.get('current')!({ name: 'Current mint' }));
  await act(async () => finish.get('old')!({ name: 'Old mint' }));

  expect(Object.keys(result.current)).toEqual(['current']);
  expect(result.current.current?.name).toBe('Current mint');
  expect(mockGetMintInfo).not.toHaveBeenCalledWith('never-start');
});

it('continues the queue when one mint rejects and retains the domain fallback', async () => {
  mockGetMintInfo
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ name: 'Available mint' });
  const urls = ['offline', 'second', 'third', 'fourth'];
  const { result } = renderHook(() => useSwapMintInfo(urls));
  await act(async () => {});
  expect(result.current.offline).toBeNull();
  expect(result.current.fourth?.name).toBe('Available mint');
  expect(mockGetMintInfo).toHaveBeenCalledTimes(4);
});
