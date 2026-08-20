/**
 * @jest-environment node
 */

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

function loadApplySafetyOffset() {
  return jest.requireActual<typeof import('@/shared/lib/map/locationPrivacy')>(
    '@/shared/lib/map/locationPrivacy'
  );
}

function distanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = radians(to.latitude - from.latitude);
  const deltaLon = radians(to.longitude - from.longitude);
  const fromLat = radians(from.latitude);
  const toLat = radians(to.latitude);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function installRandomValues(first: number, second: number) {
  const getRandomValues = jest.fn((values: Uint32Array) => {
    values.set([first, second]);
    return values;
  });
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues },
  });
  return getRandomValues;
}

describe('location privacy offset', () => {
  afterEach(() => {
    jest.resetModules();
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'crypto');
    }
  });

  it('uses one session-stable 64-bit CSPRNG draw', () => {
    const getRandomValues = installRandomValues(0, 0);

    const { applySafetyOffset } = loadApplySafetyOffset();
    const first = applySafetyOffset(51, -1);
    const second = applySafetyOffset(52, -2);

    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(getRandomValues.mock.calls[0][0]).toBeInstanceOf(Uint32Array);
    expect(getRandomValues.mock.calls[0][0]).toHaveLength(2);
    expect(distanceMeters({ latitude: 51, longitude: -1 }, first)).toBeCloseTo(750, 5);
    expect(distanceMeters({ latitude: 52, longitude: -2 }, second)).toBeCloseTo(750, 5);
  });

  it('keeps the full privacy distance for an east-west offset at high latitude', () => {
    installRandomValues(2 ** 30, 0);
    const { applySafetyOffset } = loadApplySafetyOffset();

    const from = { latitude: 80, longitude: 10 };
    const safe = applySafetyOffset(from.latitude, from.longitude);

    expect(distanceMeters(from, safe)).toBeCloseTo(750, 5);
  });

  it('normalizes longitude when the offset crosses the date line', () => {
    installRandomValues(2 ** 30, 0);
    const { applySafetyOffset } = loadApplySafetyOffset();

    const safe = applySafetyOffset(0, 179.999);

    expect(safe.longitude).toBeGreaterThanOrEqual(-180);
    expect(safe.longitude).toBeLessThan(180);
    expect(safe.longitude).toBeLessThan(-179);
  });

  it('fails closed instead of revealing the exact location without a CSPRNG', () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {},
    });

    const { applySafetyOffset } = loadApplySafetyOffset();
    expect(() => applySafetyOffset(51, -1)).toThrow();
  });

  it('fails closed when the native CSPRNG throws', () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: () => {
          throw new Error('native rng unavailable');
        },
      },
    });

    const { applySafetyOffset } = loadApplySafetyOffset();
    expect(() => applySafetyOffset(51, -1)).toThrow('native rng unavailable');
  });
});
