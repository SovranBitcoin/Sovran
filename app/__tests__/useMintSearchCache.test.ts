import { act, renderHook } from '@testing-library/react-native';
import { err, ok } from 'neverthrow';
import { useMintSearch } from '@/features/mint/hooks/useMintSearch';
import { MINT_DISCOVER_CACHE_KEY, mintDiscoverCache } from '@/features/mint/data/mintDiscoverCache';
import { discoverMints, type DiscoverMint } from '@/shared/lib/apiClient';

jest.mock('@/shared/lib/apiClient', () => {
  const actual =
    jest.requireActual<typeof import('@/shared/lib/apiClient')>('@/shared/lib/apiClient');
  return { DiscoverMintsResponse: actual.DiscoverMintsResponse, discoverMints: jest.fn() };
});
jest.mock('@/shared/stores/runtime/debugTierStore', () => ({ recordDebugTiers: jest.fn() }));
// The operator write-through reaches the Nostr data layer, which this suite
// (a discovery-cache test) does not stand up.
jest.mock('@/shared/lib/nostr/fetchProfiles', () => ({ cacheOperatorStats: jest.fn() }));
const mockUpsert = jest.fn();
jest.mock('@/shared/stores/global/mintMetadataStore', () => ({
  useMintMetadataStore: { getState: () => ({ upsertFromDiscover: mockUpsert }) },
}));
jest.mock('@/shared/stores/global/mintTestnutStore', () => ({
  useMintTestnutStore: { getState: () => ({ applyDiscover: jest.fn() }) },
}));
jest.mock('@/shared/lib/logger', () => {
  const sink = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  return {
    log: { ...sink, child: () => sink },
    storeLog: sink,
    cashuLog: sink,
    monotonicNow: () => Date.now(),
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
// The discover cache under test is a REAL in-memory store (no AsyncStorage).
jest.mock('@/features/mint/data/mintDiscoverCache', () => {
  const { createQueryCacheStore } = jest.requireActual<
    typeof import('@/shared/lib/cache/createQueryCacheStore')
  >('@/shared/lib/cache/createQueryCacheStore');
  return {
    MINT_DISCOVER_CACHE_KEY: 'all',
    mintDiscoverCache: createQueryCacheStore({
      name: 'mint-discover-cache-test',
      staleTtlMs: 20 * 60 * 1000,
      maxEntries: 1,
      hostScoped: true,
      persist: false,
    }),
  };
});

const row = (name: string, units: string[]): DiscoverMint => ({
  mintUrl: `https://${name.toLowerCase()}.example`,
  name,
  supportedUnits: units,
  nuts: { '4': { methods: units.map((unit) => ({ method: 'bolt11', unit })) } },
  averageScore: null,
  reviewCount: 0,
});

beforeEach(() => {
  mintDiscoverCache.clear();
  jest.clearAllMocks();
});

it('a fresh cached discovery paints with zero round-trips', async () => {
  mintDiscoverCache.setEntry(
    MINT_DISCOVER_CACHE_KEY,
    { mints: [row('Alpha', ['sat'])] },
    { viewerKey: '' }
  );
  const { result } = renderHook(() => useMintSearch('', 'ALL'));
  await act(async () => {});
  expect(result.current.loading).toBe(false);
  expect(result.current.status).toBe('ready');
  expect(result.current.results.map((m) => m.name)).toEqual(['Alpha']);
  expect(discoverMints).not.toHaveBeenCalled();
});

it('a currency-tab change filters locally and never refetches', async () => {
  jest
    .mocked(discoverMints)
    .mockResolvedValue(ok({ mints: [row('Alpha', ['sat']), row('Beta', ['usd'])] }));
  const { result, rerender } = renderHook(
    ({ currency }: { currency: string }) => useMintSearch('', currency),
    { initialProps: { currency: 'ALL' } }
  );
  await act(async () => {});
  expect(discoverMints).toHaveBeenCalledTimes(1);
  expect(result.current.results.map((m) => m.name)).toEqual(['Alpha', 'Beta']);
  rerender({ currency: 'USD' });
  await act(async () => {});
  expect(result.current.results.map((m) => m.name)).toEqual(['Beta']);
  expect(discoverMints).toHaveBeenCalledTimes(1);
  expect(mockUpsert).toHaveBeenCalledTimes(1);
});

it('a failed refresh keeps the cached rows and reports the error', async () => {
  mintDiscoverCache.useCacheState.setState({
    byKey: {
      [MINT_DISCOVER_CACHE_KEY]: {
        data: { mints: [row('Alpha', ['sat'])] },
        fetchedAt: 0,
        viewerKey: '',
      },
    },
  });
  jest.mocked(discoverMints).mockResolvedValue(err(new Error('offline')));
  const { result } = renderHook(() => useMintSearch('', 'ALL'));
  await act(async () => {});
  expect(result.current.results.map((m) => m.name)).toEqual(['Alpha']);
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toBe('Failed to load mints');
  // Rows stay on screen: a failed refresh is degraded, not an error state (hunch rule ui/read-states).
  expect(result.current.status).toBe('ready');
});

it('a cold miss shows loading, then the rows; refresh() re-runs discovery', async () => {
  jest.mocked(discoverMints).mockResolvedValue(ok({ mints: [row('Alpha', ['sat'])] }));
  const { result } = renderHook(() => useMintSearch('', 'ALL'));
  expect(result.current.loading).toBe(true);
  await act(async () => {});
  expect(result.current.loading).toBe(false);
  await act(async () => {
    result.current.refresh();
  });
  expect(discoverMints).toHaveBeenCalledTimes(2);
});

it('an invalid persisted payload is evicted and refetched once', async () => {
  mintDiscoverCache.setEntry(MINT_DISCOVER_CACHE_KEY, JSON.parse('{"mints":"corrupt"}') as never, {
    viewerKey: '',
  });
  jest.mocked(discoverMints).mockResolvedValue(ok({ mints: [row('Alpha', ['sat'])] }));
  const { result } = renderHook(() => useMintSearch('', 'ALL'));
  await act(async () => {});
  expect(discoverMints).toHaveBeenCalledTimes(1);
  expect(result.current.results.map((m) => m.name)).toEqual(['Alpha']);
});
