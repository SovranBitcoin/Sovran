/* eslint-disable import/first */
/**
 * @jest-environment node
 */

jest.mock('@/shared/lib/persist/fileCacheStorage', () => ({
  createFileCacheStorage: () => ({
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  }),
}));

const mockFetchJson = jest.fn();
jest.mock('@/shared/lib/apiClient', () => ({
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
