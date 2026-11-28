/* eslint-disable import/first */
/**
 * @jest-environment node
 */

const mockFileWrites: string[] = [];
jest.mock('@/shared/lib/persist/fileCacheStorage', () => ({
  createFileCacheStorage: () => ({
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async (_key: string, value: string) => void mockFileWrites.push(value)),
    removeItem: jest.fn(async () => undefined),
  }),
}));

const mockFetchJson = jest.fn();
jest.mock('@/shared/lib/apiClient', () => ({
  ...jest.requireActual('@/shared/lib/apiClient'),
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));

import {
  BTCMAP_PLACES_URL,
  btcMapPlaceDetailsUrl,
  useBTCMapStore,
} from '@/shared/stores/global/btcMapStore';

beforeEach(() => {
  mockFetchJson.mockReset();
  useBTCMapStore.getState().reset();
  mockFileWrites.length = 0;
});

describe('btcMapStore BTCMap v4 field queries', () => {
  it('requests required v4 fields (and omits deleted_at) when fetching places', async () => {
    const place = {
      id: 23143,
      lat: 42.2762511,
      lon: 42.7024218,
      icon: 'hotel',
      updated_at: '2025-09-18T05:36:26.232Z',
    };
    mockFetchJson.mockImplementationOnce(async (_url, parse) => parse([place]));

    const places = await useBTCMapStore.getState().fetchPlaces(true);

    expect(places).toEqual([place]);
    const [url] = mockFetchJson.mock.calls[0] as [string];
    expect(url).toBe(BTCMAP_PLACES_URL);
    const fields = new URL(url).searchParams.get('fields')?.split(',') ?? [];
    expect(fields).toEqual(expect.arrayContaining(['id', 'lat', 'lon', 'icon', 'updated_at']));
    expect(fields).not.toContain('deleted_at');
  });

  it('requests detail and osm:* payment/contact fields when fetching place details', async () => {
    const details = {
      id: 23143,
      lat: 42.2762511,
      lon: 42.7024218,
      icon: 'hotel',
      updated_at: '2025-09-18T05:36:26.232Z',
      name: 'Green Town',
      'osm:payment:lightning': 'yes',
      'osm:payment:onchain': 'yes',
    };
    mockFetchJson.mockImplementationOnce(async (_url, parse) => parse(details));

    const loaded = await useBTCMapStore.getState().fetchPlaceDetails(23143, true);

    expect(loaded).toEqual(details);
    const [url] = mockFetchJson.mock.calls[0] as [string];
    expect(url).toBe(btcMapPlaceDetailsUrl(23143));
    const fields = new URL(url).searchParams.get('fields')?.split(',') ?? [];
    expect(fields).toEqual(
      expect.arrayContaining([
        'id',
        'lat',
        'lon',
        'icon',
        'updated_at',
        'name',
        'verified_at',
        'osm:payment:lightning',
        'osm:payment:onchain',
        'osm:payment:lightning_contactless',
        'osm:contact:website',
        'osm:contact:phone',
      ])
    );
  });
});

describe('btcMapStore idle cost', () => {
  const place = (id: number) => ({
    id,
    lat: 51 + id / 1e6,
    lon: -0.1,
    icon: 'cafe',
    updated_at: '2025-09-18T05:36:26.232Z',
  });
  const rows = Array.from({ length: 5_000 }, (_, index) => place(index + 1));
  const serve = (body: unknown) =>
    mockFetchJson.mockImplementationOnce(async (_url, parse) => parse(body));

  it('writes the places file once per fetch, not on the loading flag', async () => {
    serve(rows);
    await useBTCMapStore.getState().fetchPlaces(true);
    // Before: one write for isLoading: true and one for the result.
    expect(mockFileWrites).toHaveLength(1);
    useBTCMapStore.getState().setError(null);
    useBTCMapStore.setState({ isLoading: false });
    expect(mockFileWrites).toHaveLength(1);
  });

  it('keeps the same array when a refetch returns the same places', async () => {
    serve(rows);
    const first = await useBTCMapStore.getState().fetchPlaces(true);
    serve(rows.map((row) => ({ ...row })));
    const second = await useBTCMapStore.getState().fetchPlaces(true);
    expect(second).toBe(first);
    // The new timestamp is still saved, once.
    expect(mockFileWrites).toHaveLength(2);
    serve(rows.map((row, index) => (index === 4_999 ? { ...row, icon: 'shop' } : row)));
    const third = await useBTCMapStore.getState().fetchPlaces(true);
    expect(third).not.toBe(first);
    expect(third[4_999].icon).toBe('shop');
  });

  it('serves the cache for 24 hours', async () => {
    serve(rows);
    await useBTCMapStore.getState().fetchPlaces(true);
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 23 * 60 * 60 * 1000);
    try {
      await useBTCMapStore.getState().fetchPlaces();
      expect(mockFetchJson).toHaveBeenCalledTimes(1);
      now.mockReturnValue(Date.now() + 25 * 60 * 60 * 1000);
      serve(rows);
      await useBTCMapStore.getState().fetchPlaces();
      expect(mockFetchJson).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });

  it('parses rows in chunks, yielding between them, with the same result and refusals', async () => {
    const timeout = jest.spyOn(global, 'setTimeout');
    serve([...rows, { id: 'x' }]);
    await expect(useBTCMapStore.getState().fetchPlaces(true)).rejects.toThrow('schema issue');
    serve([{ ...place(1), extra: 'dropped' }, ...rows.slice(1)]);
    const places = await useBTCMapStore.getState().fetchPlaces(true);
    expect(places).toHaveLength(5_000);
    expect(places[0]).toEqual(place(1));
    // 5 000 rows: two yields between three chunks, per fetch.
    expect(timeout.mock.calls.filter(([, ms]) => ms === 0).length).toBeGreaterThanOrEqual(4);
    timeout.mockRestore();
  });
});
