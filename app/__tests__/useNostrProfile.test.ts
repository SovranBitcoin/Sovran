import { act, renderHook } from '@testing-library/react-native';
import { err, ok } from 'neverthrow';
import { useLayoutEffect } from 'react';
import { useNostrProfile } from '@/shared/hooks/useNostrProfile';

const mockFetchProfile = jest.fn();
const mockFetchStats = jest.fn();
jest.mock('@/shared/lib/apiClient', () => ({
  fetchNostrProfile: (...args: unknown[]) => mockFetchProfile(...args),
}));
jest.mock('@/shared/lib/identity', () => ({ resolveIdentityName: jest.fn() }));
jest.mock('@/shared/lib/nostr/client', () => ({ npubToPubkey: jest.fn() }));
jest.mock('@/features/feed/components/nostr/feedParse', () => ({ tryNpubEncode: jest.fn() }));
jest.mock('@/shared/stores/runtime/debugTierStore', () => ({ recordDebugTiers: jest.fn() }));
jest.mock('@/shared/lib/nostr/nostrTierConfig', () => ({
  getNostrTierConfig: () => ({ nagg: { enabled: true } }),
}));
jest.mock('@/shared/lib/nostr/fetchProfiles', () => ({
  fetchProfileStatsViaFacade: (...args: unknown[]) => mockFetchStats(...args),
}));
jest.mock('@/shared/lib/logger', () => ({ log: { debug: jest.fn(), warn: jest.fn() } }));

beforeEach(() => {
  mockFetchProfile.mockReset();
  mockFetchStats.mockReset();
});

it('cancels a manual refresh when navigating to another profile and ignores its late result', async () => {
  const finish: ((profile: { pubkey: string }) => void)[] = [];
  mockFetchProfile.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish.push((profile) => resolve(ok(profile)));
      })
  );
  const { result, rerender } = renderHook(
    ({ pubkey }: { pubkey: string }) => useNostrProfile(pubkey),
    {
      initialProps: { pubkey: 'first' },
    }
  );
  act(() => result.current.refetch());
  const refreshSignal = mockFetchProfile.mock.calls[1][1].signal as AbortSignal | undefined;
  rerender({ pubkey: 'second' });
  await act(async () => finish[1]({ pubkey: 'first' }));
  expect(refreshSignal?.aborted).toBe(true);
  expect(result.current.data).toBeNull();
  expect(result.current.isLoading).toBe(true);

  await act(async () => finish[2]({ pubkey: 'second' }));
  expect(result.current.data?.pubkey).toBe('second');
  expect(result.current.isLoading).toBe(false);
});

it('never commits the previous person’s stats after changing the profile', async () => {
  mockFetchProfile
    .mockResolvedValueOnce(ok({ pubkey: 'first' }))
    .mockImplementation(() => new Promise(() => {}));
  const commits: { requested: string; shown: string | undefined; loading: boolean }[] = [];
  const { rerender } = renderHook(
    ({ pubkey }: { pubkey: string }) => {
      const profile = useNostrProfile(pubkey);
      useLayoutEffect(() => {
        commits.push({
          requested: pubkey,
          shown: profile.data?.pubkey,
          loading: profile.isLoading,
        });
      });
      return profile;
    },
    { initialProps: { pubkey: 'first' } }
  );
  await act(async () => {});
  rerender({ pubkey: 'second' });
  const secondFrames = commits.filter((frame) => frame.requested === 'second');
  expect(secondFrames[0]).toEqual({ requested: 'second', shown: undefined, loading: true });
});

it('keeps same-profile content during refresh and cancels the latest refresh on unmount', async () => {
  mockFetchProfile
    .mockResolvedValueOnce(ok({ pubkey: 'first' }))
    .mockImplementation(() => new Promise(() => {}));
  const { result, unmount } = renderHook(() => useNostrProfile('first'));
  await act(async () => {});
  act(() => result.current.refetch());
  expect(result.current.data?.pubkey).toBe('first');
  expect(result.current.isLoading).toBe(true);
  const signal = mockFetchProfile.mock.calls[1][1].signal as AbortSignal;
  unmount();
  expect(signal.aborted).toBe(true);
});

it('settles after all profile sources report unavailable', async () => {
  mockFetchProfile.mockResolvedValue(err(new Error('nagg unavailable')));
  mockFetchStats.mockResolvedValue(null);
  const { result } = renderHook(() => useNostrProfile('missing'));
  await act(async () => {});
  expect(result.current.isLoading).toBe(false);
  expect(result.current.data).toBeNull();
  expect(result.current.error?.message).toBe('profile unavailable from all tiers');
});
