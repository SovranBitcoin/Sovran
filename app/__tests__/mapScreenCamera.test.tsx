/**
 * The merchant map's programmatic camera moves, as the screen drives them:
 * zooming, My Location, and tapping a cluster each move the map view and
 * recompute the pins for the new camera at once; tapping a single merchant
 * opens its detail page.
 *
 * The BTC Map store, the cluster index and the native map view are replaced;
 * the camera and marker hooks are the real ones.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Platform } from 'react-native';
import { MapScreen } from '@/features/map/screens/MapScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockStore = {
  placesCache: { data: [{ id: 42, lat: 5, lon: 6, icon: 'restaurant' }], timestamp: 1 },
  isLoading: false,
  error: null as string | null,
  fetchPlaces: jest.fn(async () => undefined),
  setError: jest.fn(),
};
const CLUSTER = {
  id: 'cluster-1',
  type: 'cluster',
  clusterId: 7,
  latitude: 5,
  longitude: 6,
  tintColor: 'orange',
  title: '',
  count: 3,
};
const POINT = {
  id: 'point-42',
  type: 'single',
  latitude: 5,
  longitude: 6,
  tintColor: 'red',
  title: 'Merchant',
  count: 1,
  placeId: 42,
};
const mockGetClusters = jest.fn((_bbox: unknown, zoom: number) =>
  zoom < 10 ? [CLUSTER] : [POINT]
);
const mockManager = {
  isLoaded: () => true,
  getClusters: (bbox: unknown, zoom: number) => mockGetClusters(bbox, zoom),
  getClusterExpansionZoom: () => 11,
};
const mockSetCameraPosition = jest.fn();

jest.mock('@/shared/stores/global/btcMapStore', () => ({
  useBTCMapStore: (select: (state: typeof mockStore) => unknown) => select(mockStore),
}));
jest.mock('@/shared/lib/map/mapClustering', () => ({ cameraToBbox: () => [-180, -85, 180, 85] }));
jest.mock('@/shared/lib/map/btcMapClusterCache', () => ({
  getOrBuildBTCMapClusterManager: () => mockManager,
  getCachedBTCMapClusterManager: () => undefined,
}));
jest.mock('@/shared/lib/map/locationPrivacy', () => ({
  applySafetyOffset: (coords: { latitude: number; longitude: number }) => coords,
}));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 51, longitude: 0 } })),
}));
jest.mock('expo-maps', () => ({
  AppleMaps: { View: 'AppleMaps.View' },
  GoogleMaps: { View: 'GoogleMaps.View' },
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { back: jest.fn(), navigate: jest.fn() },
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: readonly string[]) => tokens.map(() => 'rgb(128, 128, 128)'),
}));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (color: string) => color }));
jest.mock('@/shared/hooks/useScreenInsets', () => ({ useScreenInsets: () => ({ bottom: 0 }) }));
jest.mock('@/shared/lib/logger', () => ({
  Log: ({ children }: { children: React.ReactNode }) => children,
  useLifecycleLogger: jest.fn(),
  log: { error: jest.fn(), info: jest.fn() },
  mapLog: { debug: jest.fn() },
  deferWork: (_name: string, work: () => void) => {
    work();
    return { cancel: jest.fn() };
  },
}));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: 'Pressable' }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: 'View' }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: 'View' }));
jest.mock('@/shared/ui/primitives/Spinner', () => ({ Spinner: () => null }));
jest.mock('@/shared/ui/composed/CircleActionButton', () => ({
  CircleActionButton: 'CircleActionButton',
}));
jest.mock('@/features/map/components/StatsCard', () => ({ StatsCard: 'StatsCard' }));
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));

const { guardedRouter: mockRouter } = jest.requireMock<{
  guardedRouter: { navigate: jest.Mock };
}>('@/shared/hooks/useGuardedRouter');

let renderer: TestRenderer.ReactTestRenderer;

async function open() {
  await act(async () => {
    renderer = TestRenderer.create(<MapScreen />, {
      createNodeMock: () => ({ setCameraPosition: mockSetCameraPosition }),
    });
  });
  // The map view mounts after a short delay; the pins are built for it.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
}

const mapView = () => renderer.root.find((node) => String(node.type) === 'AppleMaps.View');
const button = (testID: string) =>
  renderer.root.find(
    (node) => String(node.type) === 'CircleActionButton' && node.props.testID === testID
  );
const lastQueryZoom = () => mockGetClusters.mock.calls.at(-1)?.[1];
const lastMove = () => mockSetCameraPosition.mock.calls.at(-1)?.[0];

const jestPlatform = Platform.OS;
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
});
afterEach(() => {
  act(() => renderer?.unmount());
  Object.defineProperty(Platform, 'OS', { value: jestPlatform, configurable: true });
});

it('shows the pins for the opening camera, settled', async () => {
  await open();

  expect(mapView().props.markers.map((m: { id: string }) => m.id)).toEqual(['cluster-1']);
  const stats = renderer.root.find((node) => String(node.type) === 'StatsCard');
  expect(stats.props).toMatchObject({ visibleCount: 3, totalCount: 1, loading: false });
});

it('zooming in and out moves the map by two levels and recomputes the pins at once', async () => {
  await open();

  act(() => {
    button('map-zoom-in').props.onPress();
  });
  expect(lastMove()).toEqual({ coordinates: { latitude: 48, longitude: 10 }, zoom: 6 });
  expect(lastQueryZoom()).toBe(6);

  act(() => {
    button('map-zoom-out').props.onPress();
  });
  expect(lastMove()).toEqual({ coordinates: { latitude: 48, longitude: 10 }, zoom: 4 });
  expect(lastQueryZoom()).toBe(4);
});

it('My Location moves the map to the position at zoom 15 and recomputes the pins', async () => {
  await open();

  await act(async () => {
    await button('map-locate').props.onPress();
  });

  expect(lastMove()).toEqual({ coordinates: { latitude: 51, longitude: 0 }, zoom: 15 });
  expect(lastQueryZoom()).toBe(15);
});

it('a cluster tap zooms one past its expansion zoom; a merchant tap opens its page', async () => {
  await open();
  const queries = mockGetClusters.mock.calls.length;

  await act(async () => {
    await mapView().props.onMarkerClick({ id: 'cluster-1' });
  });
  expect(lastMove()).toEqual({ coordinates: { latitude: 5, longitude: 6 }, zoom: 12 });
  expect(mockGetClusters.mock.calls.length).toBe(queries + 1);
  expect(lastQueryZoom()).toBe(12);
  expect(mapView().props.markers.map((m: { id: string }) => m.id)).toEqual(['point-42']);

  await act(async () => {
    await mapView().props.onMarkerClick({ id: 'point-42' });
  });
  expect(mockRouter.navigate).toHaveBeenCalledWith({
    pathname: '/(map-flow)/detail',
    params: { placeId: '42' },
  });
});
