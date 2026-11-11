import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { MapScreen } from '@/features/map/screens/MapScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockStore = {
  placesCache: null,
  isLoading: false,
  error: 'Network request failed' as string | null,
  fetchPlaces: jest.fn(() => Promise.reject(new Error('Network request failed'))),
  setError: jest.fn(),
};

jest.mock('@/shared/stores/global/btcMapStore', () => ({
  useBTCMapStore: (select: (state: typeof mockStore) => unknown) => select(mockStore),
}));
jest.mock('@/shared/lib/map/mapClustering', () => ({ cameraToBbox: () => [-180, -85, 180, 85] }));
jest.mock('@/shared/lib/map/btcMapClusterCache', () => ({
  getOrBuildBTCMapClusterManager: jest.fn(),
  getCachedBTCMapClusterManager: jest.fn(),
}));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getCurrentPositionAsync: jest.fn(),
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
  mapLog: { debug: jest.fn(), error: jest.fn() },
  deferWork: () => ({ cancel: jest.fn() }),
}));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: 'Pressable' }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: 'View' }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: 'View' }));
jest.mock('@/shared/ui/primitives/Spinner', () => ({ Spinner: () => null }));
jest.mock('@/shared/ui/composed/CircleActionButton', () => ({ CircleActionButton: () => null }));
jest.mock('@/features/map/components/StatsCard', () => ({ StatsCard: () => null }));
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));

let renderer: TestRenderer.ReactTestRenderer;
afterEach(() => {
  act(() => renderer?.unmount());
});

// A failed first load leaves no places; Retry is the only way back to them without
// leaving the screen, so it must ask for the places again, not only hide the error.
it('fetches the places again when Retry is pressed after a failed load', async () => {
  await act(async () => {
    renderer = TestRenderer.create(<MapScreen />);
  });
  // Let the deferred mount load run (and fail) first.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(mockStore.fetchPlaces).toHaveBeenCalledTimes(1);
  const retry = renderer.root.find(
    (node) =>
      String(node.type) === 'Pressable' &&
      node.findAll((child) => String(child.type) === 'Text' && child.props.children === 'Retry')
        .length > 0
  );
  const before = mockStore.fetchPlaces.mock.calls.length;

  await act(async () => {
    retry.props.onPress();
  });

  expect(mockStore.fetchPlaces.mock.calls.length).toBe(before + 1);
});
