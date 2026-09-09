import { act, renderHook } from '@testing-library/react-native';
import { facade } from 'nostr';
import { StrictMode, useLayoutEffect } from 'react';
import { useNostrProfileMetadataMany } from '@/shared/hooks/useNostrProfileMetadata';

let mockStore: facade.NormalizingStore<facade.CachedProfile>;
const mockFetchProfiles = jest.fn();
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => ({ cache: { profiles: mockStore } }),
}));
jest.mock('@/shared/lib/nostr/fetchProfiles', () => ({
  fetchProfilesViaFacade: (...args: unknown[]) => mockFetchProfiles(...args),
}));

beforeEach(() => {
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
