import { act, renderHook } from '@testing-library/react-native';
import { err, ok } from 'neverthrow';
import { useLayoutEffect } from 'react';
import { useNostrProfile } from '@/shared/hooks/useNostrProfile';

jest.mock('@nostr-dev-kit/ndk-mobile', () => ({ useNDK: () => ({ ndk: undefined }) }), {
  virtual: true,
});
jest.mock('@/shared/lib/nostr/vertex/refreshVertex', () => ({
  refreshVertex: (...args: unknown[]) => mockRefreshVertex(...args),
  isVertexProfileStale: () => false,
}));

const mockFetchProfile = jest.fn();
const mockFetchStats = jest.fn();
const mockRefreshVertex = jest.fn();
const mockParseProfile = jest.fn();
jest.mock('@/shared/lib/apiClient', () => ({
  fetchNostrProfile: (...args: unknown[]) => mockFetchProfile(...args),
  parseNostrProfileFor: () => mockParseProfile,
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
  fetchFollowingCountViaFacade: (...args: unknown[]) => mockFetchFollowing(...args),
}));
const mockFetchFollowing = jest.fn();
jest.mock('@/shared/lib/logger', () => ({
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

beforeEach(() => {
  mockFetchProfile.mockReset();
  mockFetchStats.mockReset();
  mockFetchFollowing.mockReset().mockResolvedValue(undefined);
  mockRefreshVertex.mockReset().mockResolvedValue(null);
  mockParseProfile.mockReset();
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

it('enriches a fallback profile with Vertex without hiding its available metadata', async () => {
  mockFetchProfile.mockResolvedValue(err(new Error('not indexed')));
  mockFetchStats.mockResolvedValue({
    tier: 'primal',
    metadata: { displayName: 'Alice' },
    followersCount: 42,
  });
  let complete!: (value: object) => void;
  mockRefreshVertex.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  mockParseProfile.mockReturnValue(
    ok({ pubkey: 'alice', score: 0.9, rank: 12, followers: 0, follows: 0, created_at: null })
  );
  const { result } = renderHook(() => useNostrProfile('alice', true));
  await act(async () => {});
  expect(result.current.data).toMatchObject({ displayName: 'Alice', followers: 42 });
  expect(result.current.isLoading).toBe(false);
  expect(mockRefreshVertex).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'profile', target: 'alice', stale: true })
  );
  await act(async () => complete({ pubkeys: ['alice'], aggregates: {} }));
  expect(result.current.data).toMatchObject({
    displayName: 'Alice',
    score: 0.9,
    rank: 12,
    followers: 42,
  });
});
it('preserves fallback content when Vertex cannot refresh', async () => {
  mockFetchProfile.mockResolvedValue(err(new Error('not indexed')));
  mockFetchStats.mockResolvedValue({ tier: 'primal', metadata: { displayName: 'Alice' } });
  const { result } = renderHook(() => useNostrProfile('alice', true));
  await act(async () => {});
  expect(result.current.data?.displayName).toBe('Alice');
  expect(result.current.error).toBeNull();
});

it('completes counts nagg lacks from Primal, then the contact list, without ever showing 0', async () => {
  // nagg without the nostr module: a valid profile with no aggregates.
  mockFetchProfile.mockResolvedValue(ok({ pubkey: 'alice', score: 0.5, rank: 3 }));
  let stats!: (value: object | null) => void;
  mockFetchStats.mockImplementation(() => new Promise((resolve) => (stats = resolve)));
  mockFetchFollowing.mockResolvedValue(17);
  const { result } = renderHook(() => useNostrProfile('alice'));
  await act(async () => {});
  expect(result.current.isLoading).toBe(false);
  expect(result.current.isCountsLoading).toBe(true);
  expect(result.current.data?.followers).toBeUndefined();
  expect(result.current.data?.follows).toBeUndefined();

  // Primal knows followers only; following comes from the kind-3 fallback.
  await act(async () => stats({ tier: 'primal', followersCount: 120 }));
  expect(result.current.isCountsLoading).toBe(false);
  expect(result.current.data).toMatchObject({ followers: 120, follows: 17, score: 0.5 });
  expect(mockFetchFollowing).toHaveBeenCalledWith('alice', expect.anything());
});

it('reports unknown counts as undefined when no source can count', async () => {
  mockFetchProfile.mockResolvedValue(ok({ pubkey: 'bob', score: null, rank: 0 }));
  mockFetchStats.mockResolvedValue(null);
  mockFetchFollowing.mockResolvedValue(undefined);
  const { result } = renderHook(() => useNostrProfile('bob'));
  await act(async () => {});
  expect(result.current.isCountsLoading).toBe(false);
  expect(result.current.data?.followers).toBeUndefined();
  expect(result.current.data?.follows).toBeUndefined();
});

it('keeps completed counts when a Vertex refresh answers without aggregates', async () => {
  mockFetchProfile.mockResolvedValue(ok({ pubkey: 'alice', score: 0.5, rank: 3 }));
  mockFetchStats.mockResolvedValue({ tier: 'primal', followersCount: 120, followingCount: 9 });
  let complete!: (value: object) => void;
  mockRefreshVertex.mockImplementationOnce(() => new Promise((resolve) => (complete = resolve)));
  mockParseProfile.mockReturnValue(ok({ pubkey: 'alice', score: 0.9, rank: 12 }));
  const { result } = renderHook(() => useNostrProfile('alice', true));
  await act(async () => {});
  expect(result.current.data).toMatchObject({ followers: 120, follows: 9 });
  await act(async () => complete({ pubkeys: ['alice'], aggregates: {} }));
  expect(result.current.data).toMatchObject({ followers: 120, follows: 9, score: 0.9 });
});
