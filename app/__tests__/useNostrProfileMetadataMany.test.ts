import { act, renderHook } from '@testing-library/react-native';
import { facade } from 'nostr';
import { StrictMode, useLayoutEffect } from 'react';
import { useNostrProfileMetadataMany } from '@/shared/hooks/useNostrProfileMetadata';

let mockCache: facade.NostrEntityCache;
let mockStore: facade.NormalizingStore<facade.CachedProfile>;
const mockFetchProfiles = jest.fn();
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => ({ cache: { ...mockCache, profiles: mockStore } }),
}));
jest.mock('@/shared/lib/nostr/fetchProfiles', () => ({
  fetchProfilesViaFacade: (...args: unknown[]) => mockFetchProfiles(...args),
}));

beforeEach(() => {
  mockCache = facade.createNostrEntityCache();
  mockStore = facade.createNormalizingStore({ maxEntries: 1000 });
  mockFetchProfiles.mockReset();
});

it('settles loading after the fetch writes profiles through the reactive cache', async () => {
  let finish!: () => void;
  mockFetchProfiles.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const keys = ['contact'];
  const { result } = renderHook(() => useNostrProfileMetadataMany(keys));
  expect(result.current.isLoading).toBe(true);
  act(() => mockStore.set('contact', { name: 'Loaded contact', seenAt: Date.now() }));
  await act(async () => finish());
  expect(result.current.metadata.get('contact')?.name).toBe('Loaded contact');
  expect(result.current.isLoading).toBe(false);
});

it('only counts requests relevant to the current contacts while overlapping batches settle', async () => {
  const finish = new Map<string, () => void>();
  mockFetchProfiles.mockImplementation(
    (keys: string[]) =>
      new Promise<void>((resolve) => {
        finish.set(keys.join(','), resolve);
      })
  );
  const { result, rerender } = renderHook(
    ({ keys }: { keys: string[] }) => useNostrProfileMetadataMany(keys),
    {
      initialProps: { keys: ['old'] },
    }
  );
  rerender({ keys: ['current'] });
  await act(async () => finish.get('old')!());
  expect(result.current.isLoading).toBe(true);
  await act(async () => finish.get('current')!());
  expect(result.current.isLoading).toBe(false);
});

it('clears loading immediately for an empty contact list despite an outstanding request', () => {
  mockFetchProfiles.mockReturnValue(new Promise(() => {}));
  const { result, rerender } = renderHook(
    ({ keys }: { keys: string[] }) => useNostrProfileMetadataMany(keys),
    {
      initialProps: { keys: ['old'] },
    }
  );
  rerender({ keys: [] });
  expect(result.current.isLoading).toBe(false);
});

it('shows cold loading on its first commit and does not duplicate the request in Strict Mode', async () => {
  mockFetchProfiles.mockRejectedValue(new Error('offline'));
  const commits: boolean[] = [];
  const keys = ['contact'];
  const { result } = renderHook(
    () => {
      const value = useNostrProfileMetadataMany(keys);
      useLayoutEffect(() => {
        commits.push(value.isLoading);
      });
      return value;
    },
    { wrapper: StrictMode }
  );
  await act(async () => {});
  expect(commits[0]).toBe(true);
  expect(mockFetchProfiles).toHaveBeenCalledTimes(1);
  expect(result.current.isLoading).toBe(false);
});

it('holds seeded and missing contact avatars only until the first attempt settles', async () => {
  let finish!: (value: Record<string, never>) => void;
  mockFetchProfiles.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  mockStore.set('seed', { name: 'Stranger', seenAt: 0 });
  const keys = ['seed', 'missing'];
  const { result, rerender } = renderHook(() => useNostrProfileMetadataMany(keys));
  expect([...result.current.loadingPubkeys]).toEqual(keys);
  await act(async () => finish({}));
  expect([...result.current.loadingPubkeys]).toEqual([]);
  rerender(undefined);
  expect([...result.current.loadingPubkeys]).toEqual([]);
});

it('does not refetch a tier-fetched profile inside its freshness TTL', () => {
  const cache = facade.createNostrEntityCache();
  mockStore = cache.profiles;
  cache.ingestProfileMetadata({ contact: { name: 'Fresh contact' } }, 1, 'primal');
  const { result } = renderHook(() => useNostrProfileMetadataMany(['contact']));
  expect(result.current.metadata.get('contact')?.fetchedAt).toBeGreaterThan(Date.now() - 1000);
  expect(result.current.isLoading).toBe(false);
  expect([...result.current.loadingPubkeys]).toEqual([]);
  expect(mockFetchProfiles).not.toHaveBeenCalled();
});

it('keeps a previously settled miss out of grey on a new consumer', () => {
  mockFetchProfiles.mockReturnValue(new Promise(() => {}));
  mockCache.pendingProfiles.begin(['stranger']);
  mockCache.pendingProfiles.end(['stranger']);
  const { result } = renderHook(() => useNostrProfileMetadataMany(['stranger']));
  expect(result.current.loadingPubkeys.has('stranger')).toBe(false);
});
