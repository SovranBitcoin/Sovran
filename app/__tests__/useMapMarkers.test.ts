import { act, renderHook } from '@testing-library/react-native';
import { useMapMarkers } from '@/features/map/hooks/useMapMarkers';
import type { CategoryFilter } from '@/features/map/components/StatsCard';

const mockPlace = { id: 1, lat: 1, lon: 2, icon: 'restaurant' };
const mockMarker = {
  id: 'point-1',
  type: 'single',
  latitude: 1,
  longitude: 2,
  tintColor: 'red',
  title: 'Merchant',
  count: 1,
  placeId: 1,
};
const mockManager = { isLoaded: () => true, getClusters: () => [mockMarker] };
const mockBuild = jest.fn(() => mockManager);
const mockCached = jest.fn();
const mockTasks: { work: () => void; cancelled: boolean }[] = [];
let mockFocused = true;
const mockStore = {
  placesCache: { data: [mockPlace], timestamp: 1 },
  isLoading: false,
  error: null,
  fetchPlaces: jest.fn(),
  setError: jest.fn(),
};
const getCamera = () => ({ lat: 0, lon: 0, zoom: 3 });

jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/shared/stores/global/btcMapStore', () => ({
  useBTCMapStore: (select: (state: typeof mockStore) => unknown) => select(mockStore),
}));
jest.mock('@/shared/lib/map/mapClustering', () => ({ cameraToBbox: () => [-180, -85, 180, 85] }));
jest.mock('@/shared/lib/map/btcMapClusterCache', () => ({
  getOrBuildBTCMapClusterManager: (...args: unknown[]) => mockBuild(...(args as [])),
  getCachedBTCMapClusterManager: (...args: unknown[]) => mockCached(...args),
}));
jest.mock('@/shared/lib/logger', () => ({
  mapLog: { debug: jest.fn() },
  deferWork: (_name: string, work: () => void) => {
    const task = { work, cancelled: false };
    mockTasks.push(task);
    return {
      cancel: () => {
        task.cancelled = true;
      },
    };
  },
}));

function flushDeferred() {
  act(() => {
    for (const task of mockTasks.splice(0)) if (!task.cancelled) task.work();
  });
}
function mount() {
  return renderHook(
    ({ category }: { category: CategoryFilter }) =>
      useMapMarkers({ category, aspectRatio: 1, isMapReady: true, getCamera }),
    { initialProps: { category: 'all' as CategoryFilter } }
  );
}
beforeEach(() => {
  mockTasks.length = 0;
  mockFocused = true;
  mockBuild.mockClear();
  mockCached.mockReset();
});

test('empty filters clear tappable marker identity and returning to the same pins restores them', () => {
  const { result, rerender } = mount();
  flushDeferred();
  expect(result.current.markers).toHaveLength(1);
  rerender({ category: 'atm' });
  expect(result.current.markers).toEqual([]);
  expect(result.current.resolveMarker('point-1')).toBeUndefined();
  rerender({ category: 'all' });
  flushDeferred();
  expect(result.current.markers).toHaveLength(1);
  expect(result.current.visibleCount).toBe(1);
});

test('blurring the map cancels its pending synchronous index build until it is focused again', () => {
  const { rerender } = mount();
  mockFocused = false;
  rerender({ category: 'all' });
  flushDeferred();
  expect(mockBuild).not.toHaveBeenCalled();
  mockFocused = true;
  rerender({ category: 'all' });
  flushDeferred();
  expect(mockBuild).toHaveBeenCalledTimes(1);
});

test('a hidden map does not schedule a cold index build', () => {
  mockFocused = false;
  mount();
  expect(mockTasks).toHaveLength(0);
});

test('a cached index renders on reopen without another deferred build window', () => {
  mockCached.mockReturnValue(mockManager);
  const { result } = mount();
  expect(result.current.markers).toHaveLength(1);
  expect(result.current.isClusteringReady).toBe(true);
  expect(mockTasks).toHaveLength(0);
  expect(mockBuild).not.toHaveBeenCalled();
});
