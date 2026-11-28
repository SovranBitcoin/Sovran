/** @jest-environment node */
import * as Location from 'expo-location';

import { resolveNearbyCoords } from '@/features/wallet/components/BitcoinNearYou';

/** A partial fixture where only the read fields matter. */
const loose = (value: unknown): never => value as never;

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));
jest.mock('expo-maps', () => ({ AppleMaps: {}, GoogleMaps: {} }));
jest.mock('@/shared/lib/map/locationPrivacy', () => ({
  applySafetyOffset: (coords: { latitude: number; longitude: number }) => ({
    latitude: coords.latitude + 0.01,
    longitude: coords.longitude,
  }),
}));

const focus = async () => {
  const setCoords = jest.fn();
  const setPermStatus = jest.fn();
  await resolveNearbyCoords({ isCancelled: () => false, setCoords, setPermStatus });
  return { setCoords, setPermStatus };
};

it('checks permission on every focus but asks for a fix at most once per 10 minutes', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
  jest
    .mocked(Location.getForegroundPermissionsAsync)
    .mockResolvedValue(loose({ status: 'granted', canAskAgain: true }));
  jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue(null);
  jest
    .mocked(Location.getCurrentPositionAsync)
    .mockResolvedValue(loose({ coords: { latitude: 51, longitude: 0 } }));
  try {
    const first = await focus();
    expect(first.setCoords).toHaveBeenCalledWith({ latitude: 51.01, longitude: 0 });
    // Ten tab switches in the next minutes: no location request.
    for (let i = 1; i <= 10; i++) {
      now.mockReturnValue(1_800_000_000_000 + i * 50_000);
      const again = await focus();
      expect(again.setCoords).toHaveBeenCalledWith({ latitude: 51.01, longitude: 0 });
      expect(again.setPermStatus).toHaveBeenCalledWith('granted');
    }
    expect(Location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(11);
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
    expect(Location.getLastKnownPositionAsync).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_800_000_000_000 + 11 * 60_000);
    await focus();
    expect(Location.getLastKnownPositionAsync).toHaveBeenCalledTimes(2);
    // Revoked: nothing is read, and the card reports it.
    jest
      .mocked(Location.getForegroundPermissionsAsync)
      .mockResolvedValue(loose({ status: 'denied', canAskAgain: false }));
    const denied = await focus();
    expect(denied.setPermStatus).toHaveBeenCalledWith('denied');
    expect(denied.setCoords).not.toHaveBeenCalled();
  } finally {
    now.mockRestore();
  }
});
