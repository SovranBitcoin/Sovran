import { act, renderHook } from '@testing-library/react-native';
import { ok } from 'neverthrow';
import { useLayoutEffect } from 'react';
import { useNostrProfile } from '@/shared/hooks/useNostrProfile';

jest.mock('@/shared/providers/NostrClientProvider', () => ({
  useNostrClient: () => ({ client: undefined, isInitialized: false }),
}));
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
jest.mock('@/shared/lib/nostr/nostrBech32', () => ({ tryNpubEncode: jest.fn() }));
jest.mock('@/shared/stores/runtime/debugTierStore', () => ({ recordDebugTiers: jest.fn() }));
jest.mock('@/shared/lib/nostr/nostrTierConfig', () => ({
  getNostrTierConfig: () => ({ nagg: { enabled: true } }),
}));
const mockReadCachedStats = jest.fn();
const mockCacheStats = jest.fn();
jest.mock('@/shared/lib/nostr/fetchProfiles', () => ({
  fetchProfileStatsViaFacade: (...args: unknown[]) => mockFetchStats(...args),
  fetchFollowingCountViaFacade: (...args: unknown[]) => mockFetchFollowing(...args),
  readCachedProfileStats: (...args: unknown[]) => mockReadCachedStats(...args),
  cacheProfileStats: (...args: unknown[]) => mockCacheStats(...args),
}));
const mockFetchFollowing = jest.fn();
jest.mock('@/shared/lib/logger', () => {
  const sink = { debug: jest.fn(), info: jest.fn(), warn: jest.fn() };
  return {
    log: { ...sink, child: () => sink },
    monotonicNow: () => Date.now(),
    // Render-diagnostics emitter (loggerRender) — a no-op here: it only emits,
    // and these tests assert on the hook's returned state.
    useQueryResultLogger: () => {},
  };
});

beforeEach(() => {
  mockReadCachedStats.mockReset().mockReturnValue(undefined);
  mockCacheStats.mockReset();
  mockFetchProfile.mockReset();
  mockFetchStats.mockReset();
  mockFetchFollowing.mockReset().mockResolvedValue(undefined);
  mockRefreshVertex.mockReset().mockResolvedValue(null);
  mockParseProfile.mockReset();
});

it('cancels a manual refresh when navigating to another profile and ignores its late result', async () => {
  const finish: ((stats: { tier: 'primal'; followersCount: number }) => void)[] = [];
  mockFetchStats.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish.push((stats) => resolve(stats));
      })
  );
  const { result, rerender } = renderHook(
    ({ pubkey }: { pubkey: string }) => useNostrProfile(pubkey),
    {
      initialProps: { pubkey: 'first' },
    }
  );
  act(() => result.current.refetch());
  const refreshSignal = mockFetchStats.mock.calls[1][1].signal as AbortSignal | undefined;
  rerender({ pubkey: 'second' });
  await act(async () => finish[1]({ tier: 'primal', followersCount: 10 }));
  expect(refreshSignal?.aborted).toBe(true);
  expect(result.current.data).toBeNull();
  expect(result.current.isLoading).toBe(true);

  await act(async () => finish[2]({ tier: 'primal', followersCount: 20 }));
  expect(result.current.data?.pubkey).toBe('second');
  expect(result.current.isLoading).toBe(false);
});

it('never commits the previous person’s stats after changing the profile', async () => {
  mockFetchStats
    .mockResolvedValueOnce({ tier: 'primal', followersCount: 10, followingCount: 5 })
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
  mockFetchStats
    .mockResolvedValueOnce({ tier: 'primal', followersCount: 10, followingCount: 5 })
    .mockImplementation(() => new Promise(() => {}));
  const { result, unmount } = renderHook(() => useNostrProfile('first'));
  await act(async () => {});
  act(() => result.current.refetch());
  expect(result.current.data?.pubkey).toBe('first');
  expect(result.current.isLoading).toBe(true);
  const signal = mockFetchStats.mock.calls[1][1].signal as AbortSignal;
  unmount();
  expect(signal.aborted).toBe(true);
});

it('settles after all profile sources report unavailable', async () => {
  mockFetchStats.mockResolvedValue(null);
  const { result } = renderHook(() => useNostrProfile('missing'));
  await act(async () => {});
  expect(result.current.isLoading).toBe(false);
  expect(result.current.data).toBeNull();
  expect(result.current.error?.message).toBe('profile unavailable from all tiers');
});

it('enriches a fallback profile with Vertex without hiding its available metadata', async () => {
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
  mockFetchStats.mockResolvedValue({ tier: 'primal', metadata: { displayName: 'Alice' } });
  const { result } = renderHook(() => useNostrProfile('alice', true));
  await act(async () => {});
  expect(result.current.data?.displayName).toBe('Alice');
  expect(result.current.error).toBeNull();
});

it('completes missing following count from the contact list without ever showing 0', async () => {
  mockFetchStats.mockResolvedValue({ tier: 'primal', followersCount: 120 });
  let resolveFollowing!: (value: number | undefined) => void;
  mockFetchFollowing.mockImplementation(
    () => new Promise((resolve) => (resolveFollowing = resolve))
  );
  const { result } = renderHook(() => useNostrProfile('alice'));
  await act(async () => {});
  expect(result.current.isLoading).toBe(false);
  expect(result.current.isCountsLoading).toBe(true);
  expect(result.current.data?.followers).toBe(120);
  expect(result.current.data?.follows).toBeUndefined();

  await act(async () => resolveFollowing(17));
  expect(result.current.isCountsLoading).toBe(false);
  expect(result.current.data).toMatchObject({ followers: 120, follows: 17 });
  expect(mockFetchFollowing).toHaveBeenCalledWith('alice', expect.anything());
});

it('reports unknown counts as undefined when no source can count', async () => {
  mockFetchStats.mockResolvedValue({ tier: 'relay', metadata: { displayName: 'Bob' } });
  mockFetchFollowing.mockResolvedValue(undefined);
  const { result } = renderHook(() => useNostrProfile('bob'));
  await act(async () => {});
  expect(result.current.isCountsLoading).toBe(false);
  expect(result.current.data?.followers).toBeUndefined();
  expect(result.current.data?.follows).toBeUndefined();
});

it('keeps completed counts when a Vertex refresh answers without aggregates', async () => {
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

it('seeds the header from cached profile stats on the first frame and keeps it while revalidating', async () => {
  mockReadCachedStats.mockReturnValue({ pubkey: 'carol', followersCount: 40, followingCount: 12 });
  let finish!: (value: unknown) => void;
  mockFetchStats.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
  const { result } = renderHook(() => useNostrProfile('carol'));
  expect(result.current.data).toMatchObject({ followers: 40, follows: 12 });
  expect(result.current.isLoading).toBe(true); // revalidating behind a seeded header
  await act(async () => finish({ tier: 'primal', score: 0.2, rank: 1, followersCount: 41 }));
  expect(result.current.data).toMatchObject({ followers: 41, follows: 12, score: 0.2 });
});

it('a cached score paints on the first frame and survives an answer without one', async () => {
  mockReadCachedStats.mockReturnValue({ pubkey: 'erin', followersCount: 40, score: 71, rank: 3 });
  let finish!: (value: unknown) => void;
  mockFetchStats.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
  const { result } = renderHook(() => useNostrProfile('erin'));
  expect(result.current.data).toMatchObject({ followers: 40, score: 71, rank: 3 });
  await act(async () => finish({ tier: 'primal', followersCount: 41, followingCount: 5 }));
  expect(result.current.data).toMatchObject({ followers: 41, score: 71 });
});

it('a focus change does not restart the ladder', async () => {
  mockFetchStats.mockResolvedValue({
    tier: 'primal',
    score: 0.1,
    rank: 1,
    followersCount: 1,
    followingCount: 1,
    vertexFetchedAt: Date.now() / 1000,
  });
  const { rerender } = renderHook(
    ({ focused }: { focused: boolean }) => useNostrProfile('dave', focused),
    {
      initialProps: { focused: false },
    }
  );
  await act(async () => {});
  expect(mockFetchStats).toHaveBeenCalledTimes(1);
  rerender({ focused: true });
  await act(async () => {});
  rerender({ focused: false });
  await act(async () => {});
  expect(mockFetchStats).toHaveBeenCalledTimes(1);
});
