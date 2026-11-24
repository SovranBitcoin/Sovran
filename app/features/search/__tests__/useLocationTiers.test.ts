/**
 * The Bluetooth mesh row needs no location, and Search never asks for one.
 */
import { renderHook, waitFor } from '@testing-library/react-native';

import { BLUETOOTH_TIER_ENTRY, useLocationTiers } from '@/features/bitchat/hooks/useLocationTiers';

const mockGetPermission = jest.fn();
const mockRequestPermission = jest.fn();
const mockGetPosition = jest.fn();

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: (...args: unknown[]) => mockGetPermission(...args),
  requestForegroundPermissionsAsync: (...args: unknown[]) => mockRequestPermission(...args),
  getCurrentPositionAsync: (...args: unknown[]) => mockGetPosition(...args),
  reverseGeocodeAsync: async () => [],
}));

beforeEach(() => {
  jest.resetAllMocks();
});

it('reads nothing while disabled, so opening Search touches no location', () => {
  const { result } = renderHook(() =>
    useLocationTiers({ enabled: false, requestPermission: false })
  );
  expect(result.current.tiers).toEqual([]);
  expect(mockGetPermission).not.toHaveBeenCalled();
  expect(mockRequestPermission).not.toHaveBeenCalled();
  expect(mockGetPosition).not.toHaveBeenCalled();
});

it('offers the Bluetooth row when the location is not allowed, without asking', async () => {
  mockGetPermission.mockResolvedValue({ status: 'denied' });
  const { result } = renderHook(() =>
    useLocationTiers({ enabled: true, requestPermission: false })
  );
  await waitFor(() => expect(result.current.tiers).toEqual([BLUETOOTH_TIER_ENTRY]));
  expect(mockRequestPermission).not.toHaveBeenCalled();
  expect(mockGetPosition).not.toHaveBeenCalled();
});

it('offers the Bluetooth row when no fix arrives', async () => {
  mockGetPermission.mockResolvedValue({ status: 'granted' });
  mockGetPosition.mockRejectedValue(new Error('Location services are off'));
  const { result } = renderHook(() =>
    useLocationTiers({ enabled: true, requestPermission: false })
  );
  await waitFor(() => expect(result.current.tiers).toEqual([BLUETOOTH_TIER_ENTRY]));
  expect(result.current.error).toBe('Location services are off');
});

it('adds the place rows after Bluetooth when a fix arrives', async () => {
  mockGetPermission.mockResolvedValue({ status: 'granted' });
  mockGetPosition.mockResolvedValue({
    coords: { latitude: 51.5, longitude: -0.12 },
  });
  const { result } = renderHook(() =>
    useLocationTiers({ enabled: true, requestPermission: false })
  );
  await waitFor(() => expect(result.current.tiers.length).toBeGreaterThan(1));
  expect(result.current.tiers[0]).toEqual(BLUETOOTH_TIER_ENTRY);
});
