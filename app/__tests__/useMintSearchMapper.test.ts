import {
  discoverMintToSearchResult,
  discoveryMethodMatches,
} from '@/features/mint/lib/mintDiscoveryRows';
import { useMintSearch } from '@/features/mint/hooks/useMintSearch';
import { renderHook, waitFor } from '@testing-library/react-native';
import { ok } from 'neverthrow';
import { discoverMints } from '@/shared/lib/apiClient';
import type { DiscoverMint } from '@/shared/lib/apiClient';
import { mintDiscoverCache } from '@/features/mint/data/mintDiscoverCache';

jest.mock('@/shared/lib/apiClient', () => {
  const actual =
    jest.requireActual<typeof import('@/shared/lib/apiClient')>('@/shared/lib/apiClient');
  return { DiscoverMintsResponse: actual.DiscoverMintsResponse, discoverMints: jest.fn() };
});
jest.mock('@/shared/stores/runtime/debugTierStore', () => ({ recordDebugTiers: jest.fn() }));
jest.mock('@/shared/stores/global/mintMetadataStore', () => ({
  useMintMetadataStore: { getState: () => ({ upsertFromDiscover: jest.fn() }) },
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
jest.mock('@/features/mint/data/mintDiscoverCache', () => {
  const { createQueryCacheStore } = jest.requireActual<
    typeof import('@/shared/lib/cache/createQueryCacheStore')
  >('@/shared/lib/cache/createQueryCacheStore');
  return {
    MINT_DISCOVER_CACHE_KEY: 'all',
    mintDiscoverCache: createQueryCacheStore({
      name: 'mint-discover-cache-mapper-test',
      staleTtlMs: 20 * 60 * 1000,
      maxEntries: 1,
      hostScoped: true,
      persist: false,
    }),
  };
});

const base: DiscoverMint = {
  mintUrl: 'https://mint.example',
  name: 'Example Mint',
  iconUrl: 'https://i/x.png',
  description: 'a mint',
  supportedUnits: ['sat', 'usd'],
  // Raw NUT-06 capability map, as nagg passes it through from the auditor.
  nuts: {
    '4': {
      methods: [
        { method: 'bolt11', unit: 'sat' },
        { method: 'bolt12', unit: 'sat' },
        { method: 'bolt11', unit: 'usd' },
      ],
    },
    '5': { methods: [{ method: 'bolt11', unit: 'sat' }] },
    '7': { supported: true },
  },
  averageScore: 4.5,
  reviewCount: 12,
  favouriteCount: 3,
  hasAudit: true,
  state: 'OK',
  nMints: 100,
  nMelts: 40,
  nErrors: 2,
  operatorPubkey: 'a'.repeat(64),
  followers: 1234,
  vertexScore: 0.8,
};

describe('discoverMintToSearchResult', () => {
  it('maps a full discovery row to the screen MintSearchResult shape', () => {
    const r = discoverMintToSearchResult(base);
    expect(r).toMatchObject({
      url: 'https://mint.example',
      name: 'Example Mint',
      supported_units: ['sat', 'usd'],
      state: 'OK',
      n_mints: 100,
      n_melts: 40,
      n_errors: 2,
      review_score: 4.5, // inline, no per-mint fan-out
      review_count: 12,
      // Derived from nuts['4'].methods (deduped, order-preserving).
      supported_methods: ['bolt11', 'bolt12'],
      // Full (method, unit) pairs retained for unit-aware discovery filtering.
      supported_method_units: [
        { method: 'bolt11', unit: 'sat' },
        { method: 'bolt12', unit: 'sat' },
        { method: 'bolt11', unit: 'usd' },
      ],
    });
    // operator pubkey surfaced as a NUT-06 nostr contact for the profile path
    expect((r.info as { contact: { method: string; info: string }[] }).contact).toEqual([
      { method: 'nostr', info: 'a'.repeat(64) },
    ]);
    expect((r.info as { icon_url: string }).icon_url).toBe('https://i/x.png');
  });

  it('tolerates a Nostr-only row (no audit / operator)', () => {
    const r = discoverMintToSearchResult({
      mintUrl: 'https://m2',
      averageScore: null,
      reviewCount: 1,
    });
    expect(r).toMatchObject({
      url: 'https://m2',
      name: 'https://m2', // falls back to url
      supported_units: [],
      // No nuts map (auditor had no info) — the method filter treats this
      // as "not known to support".
      supported_methods: [],
      state: 'unknown',
      review_score: null,
      review_count: 1,
    });
    expect((r.info as { contact: unknown[] }).contact).toEqual([]);
  });
});

describe('discoveryMethodMatches — unit-aware (method, unit) pair filter', () => {
  const mint = (mintUrl: string, methods: { method: string; unit: string }[]) =>
    discoverMintToSearchResult({
      mintUrl,
      averageScore: null,
      reviewCount: 0,
      nuts: { '4': { methods } },
    });

  const satBolt12 = mint('https://sat', [{ method: 'bolt12', unit: 'sat' }]);
  const eurBolt12 = mint('https://eur', [{ method: 'bolt12', unit: 'eur' }]);

  it('excludes a bolt12+eur-only mint for a (bolt12, SAT) rail, keeps bolt12+sat', () => {
    expect(discoveryMethodMatches(satBolt12, 'bolt12', 'SAT')).toBe(true);
    expect(discoveryMethodMatches(eurBolt12, 'bolt12', 'SAT')).toBe(false);
  });

  it("currency 'ALL' falls back to method-only (browse every unit)", () => {
    expect(discoveryMethodMatches(eurBolt12, 'bolt12', 'ALL')).toBe(true);
  });

  it('no method filter leaves rows unfiltered', () => {
    expect(discoveryMethodMatches(eurBolt12, undefined, 'SAT')).toBe(true);
  });

  it('matches case-insensitively and rejects the wrong method on the right unit', () => {
    expect(discoveryMethodMatches(satBolt12, 'BOLT12', 'sat')).toBe(true);
    expect(discoveryMethodMatches(satBolt12, 'onchain', 'SAT')).toBe(false);
  });
});

describe('useMintSearch unit availability and counts', () => {
  const rows: DiscoverMint[] = [
    {
      ...base,
      mintUrl: 'https://alpha.example',
      name: 'Alpha',
      supportedUnits: ['sat', 'eur', 'jpy'],
      nuts: {
        '4': {
          methods: [
            { method: 'onchain', unit: 'sat' },
            { method: 'onchain', unit: 'sat' },
            { method: 'bolt11', unit: 'eur' },
          ],
        },
      },
    },
    {
      ...base,
      mintUrl: 'https://beta.example',
      name: 'Beta',
      supportedUnits: ['SAT', 'gbp'],
      nuts: {
        '4': {
          methods: [
            { method: 'onchain', unit: 'sat' },
            { method: 'onchain', unit: 'gbp' },
          ],
        },
      },
    },
  ];

  beforeEach(() => {
    mintDiscoverCache.clear();
    jest.mocked(discoverMints).mockResolvedValue(ok({ mints: rows }));
  });

  it('keeps unfiltered units and a zero-count deep-linked USD selection', async () => {
    const { result } = renderHook(() => useMintSearch('Alpha', 'USD', { method: 'onchain' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.results).toEqual([]);
    expect(result.current.availableUnits).toEqual(['SAT', 'EUR', 'GBP', 'USD']);
    expect(result.current.matchCountByUnit).toEqual({ SAT: 1, USD: 0, EUR: 0, GBP: 0 });
  });

  it('counts each matching mint once per exact method/unit pair and switches to SAT', async () => {
    const { result, rerender } = renderHook(
      ({ currency }: { currency: string }) => useMintSearch('', currency, { method: 'onchain' }),
      { initialProps: { currency: 'USD' } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.matchCountByUnit).toEqual({ SAT: 2, USD: 0, EUR: 0, GBP: 1 });
    rerender({ currency: 'SAT' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.results.map((mint) => mint.name)).toEqual(['Alpha', 'Beta']);
    expect(result.current.matchCountByUnit.SAT).toBe(2);
  });

  it('counts supported units without a method filter and matches a trimmed URL query', async () => {
    const { result } = renderHook(() => useMintSearch('  ALPHA.EXAMPLE  ', 'ALL'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.matchCountByUnit).toEqual({ SAT: 1, USD: 0, EUR: 1, GBP: 0 });
    expect(result.current.availableUnits).toEqual(['SAT', 'EUR', 'GBP']);
  });

  it('seeds SAT and retains the requested unit when discovery is empty', async () => {
    jest.mocked(discoverMints).mockResolvedValue(ok({ mints: [] }));
    const { result } = renderHook(() => useMintSearch('', 'USD', { method: 'onchain' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.availableUnits).toEqual(['SAT', 'USD']);
    expect(result.current.matchCountByUnit).toEqual({ SAT: 0, USD: 0, EUR: 0, GBP: 0 });
  });
});
