import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchWallpaperCatalog } from '@/shared/lib/apiClient';
import { refreshCatalog } from '@/shared/lib/wallpaperSync';
import { useWallpaperStore } from '@/shared/stores/global/wallpaperStore';
import { useBTCMapStore } from '@/shared/stores/global/btcMapStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@/shared/config/backend', () => ({
  backendConfig: {
    scoreApiBaseUrl: 'https://catalog.example.test',
    nostrAppViewBaseUrl: 'https://nostr.example.test',
  },
}));
jest.mock('wallet', () => ({
  combineSignals: (...signals: (AbortSignal | undefined)[]) =>
    signals.find((signal): signal is AbortSignal => !!signal) ?? new AbortController().signal,
  createNostrMintEnrichment: () => ({}),
  isAbortError: () => false,
  timeoutSignal: () => new AbortController().signal,
}));
jest.mock('@/shared/lib/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn() },
  storeLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  apiLog: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: () => 'redacted',
}));
jest.mock('@/shared/lib/downloadedThemeRegistry', () => ({
  registerDownloadedTheme: jest.fn(),
  unregisterDownloadedTheme: jest.fn(),
}));
jest.mock('@/shared/lib/wallpaperStorage', () => ({
  cleanupOrphanedFiles: jest.fn(),
}));
jest.mock('@/shared/stores/profile/themeStore', () => ({}));
jest.mock('@/shared/lib/constants', () => ({ PUBLIC_KEYS: { SUPPORT: 'a'.repeat(64) } }));

const wallpaper = {
  eventId: 'b'.repeat(64),
  themeName: 'fixture',
  displayName: 'Fixture',
  blossomUrl: 'https://images.example.test/full.png',
  thumbUrl: 'https://images.example.test/thumb.png',
  sha256: 'c'.repeat(64),
  fileSize: 42,
  dimensions: '1080x1920',
  albumSlug: 'fixture',
  palette: {},
  dominantColors: [],
  gradientColors: [],
  createdAt: 1,
};
const album = { slug: 'fixture', displayName: 'Fixture' };
const catalog = { wallpapers: [wallpaper], albums: [album], lastUpdated: 1 };
const place = { id: 42, lat: 51.5, lon: -0.1, icon: 'cafe', updated_at: '2026-09-13' };
const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
const mockFetch = jest.fn();
const respond = (payload: unknown) =>
  mockFetch.mockResolvedValue({ ok: true, json: async () => payload });

beforeEach(async () => {
  await Promise.all([useWallpaperStore.persist.rehydrate(), useBTCMapStore.persist.rehydrate()]);
  useWallpaperStore.setState({ catalog: [], albums: [], catalogLastFetched: 0, downloaded: {} });
  useBTCMapStore.getState().reset();
  await AsyncStorage.clear();
  mockFetch.mockReset();
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: mockFetch,
  });
});

afterAll(() => {
  if (originalFetchDescriptor) Object.defineProperty(globalThis, 'fetch', originalFetchDescriptor);
  else Reflect.deleteProperty(globalThis, 'fetch');
});

it('fetches wallpapers from the app module and tolerates new fields and omitted album defaults', async () => {
  respond({ ...catalog, future: true, wallpapers: [{ ...wallpaper, future: true }] });
  const controller = new AbortController();
  const result = await fetchWallpaperCatalog({ signal: controller.signal });
  expect(mockFetch).toHaveBeenCalledWith('https://catalog.example.test/app/wallpapers', {
    signal: controller.signal,
  });
  expect(result.isOk()).toBe(true);
  if (result.isOk()) {
    expect(result.value.wallpapers).toEqual([wallpaper]);
    expect(result.value.albums).toEqual([
      { ...album, description: '', sortOrder: 0, topic: 'Other' },
    ]);
  }
  expect(await refreshCatalog()).toBe(true);
  expect(useWallpaperStore.getState().catalog).toEqual([wallpaper]);
});

const failures = ['503', 'network', 'malformed'] as const;
function failRequest(kind: (typeof failures)[number]) {
  if (kind === '503') {
    mockFetch.mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' });
  } else if (kind === 'network') {
    mockFetch.mockRejectedValue(new Error('Network request failed'));
  } else {
    respond({ unexpected: true });
  }
}

it.each(failures)('retains the hydrated last wallpaper catalog on %s', async (failure) => {
  await AsyncStorage.setItem(
    'wallpaper-store',
    JSON.stringify({
      version: 1,
      state: {
        catalog: [wallpaper],
        albums: [{ ...album, topic: 'Other' }],
        catalogLastFetched: 123,
        downloaded: {},
      },
    })
  );
  await useWallpaperStore.persist.rehydrate();
  const { catalog: previousCatalog, albums, catalogLastFetched } = useWallpaperStore.getState();
  expect(previousCatalog).toHaveLength(1);
  failRequest(failure);
  expect(await refreshCatalog()).toBe(false);
  expect(useWallpaperStore.getState().catalog).toBe(previousCatalog);
  expect(useWallpaperStore.getState().albums).toBe(albums);
  expect(useWallpaperStore.getState().catalogLastFetched).toBe(catalogLastFetched);
});

it('routes BTC Map list and details to the configured app module, preserving osm fields', async () => {
  respond([{ ...place, future: true }]);
  const controller = new AbortController();
  expect(await useBTCMapStore.getState().fetchPlaces(false, { signal: controller.signal })).toEqual(
    [place]
  );
  expect(mockFetch).toHaveBeenLastCalledWith('https://catalog.example.test/app/btcmap/places', {
    signal: controller.signal,
  });
  // A fresh cache avoids a second request.
  await useBTCMapStore.getState().fetchPlaces();
  expect(mockFetch).toHaveBeenCalledTimes(1);

  const details = { ...place, name: 'Cafe', 'osm:payment:lightning': 'yes', future: true };
  respond(details);
  expect(await useBTCMapStore.getState().fetchPlaceDetails(42)).toEqual(details);
  expect(mockFetch).toHaveBeenLastCalledWith(
    'https://catalog.example.test/app/btcmap/places/42',
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
  await useBTCMapStore.getState().fetchPlaceDetails(42);
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

it.each(failures)(
  'serves expired persisted BTC Map places on %s without marking them fresh',
  async (failure) => {
    await AsyncStorage.setItem(
      'btcmap-store',
      JSON.stringify({
        version: 1,
        state: { placesCache: { data: [place], timestamp: 1 }, placeDetailsCache: {} },
      })
    );
    await useBTCMapStore.persist.rehydrate();
    expect(useBTCMapStore.getState().getCachedPlaces()).toBeNull();
    failRequest(failure);
    expect(await useBTCMapStore.getState().fetchPlaces()).toEqual([place]);
    expect(useBTCMapStore.getState().placesCache?.timestamp).toBe(1);
    expect(useBTCMapStore.getState().isLoading).toBe(false);
    expect(useBTCMapStore.getState().error).toBeTruthy();
  }
);

it('rejects unavailable or malformed BTC Map data when no cache exists', async () => {
  failRequest('503');
  await expect(useBTCMapStore.getState().fetchPlaces()).rejects.toThrow('503');
  respond({ ...place, lat: 100 });
  await expect(useBTCMapStore.getState().fetchPlaceDetails(42)).rejects.toThrow();
  expect(useBTCMapStore.getState().placeDetailsCache).toEqual({});
});
