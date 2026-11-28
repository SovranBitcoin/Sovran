/** @jest-environment node */
// The module under test owns a legacy native-driver Animated.ValueXY.
// eslint-disable-next-line no-restricted-imports
import { Animated } from 'react-native';
import { DeviceMotion } from 'expo-sensors';
import { retainWallpaperMotion, wallpaperMotion } from '@/shared/lib/theme/wallpaperMotion';

jest.mock('expo-sensors', () => ({
  DeviceMotion: { setUpdateInterval: jest.fn(), addListener: jest.fn() },
}));
jest.mock('@/shared/lib/logger', () => ({ log: { debug: jest.fn() } }));

it('shares one sensor subscription and stops the native spring on the final idempotent release', () => {
  const remove = jest.fn();
  jest.spyOn(DeviceMotion, 'addListener').mockReturnValue({ remove });
  const spring = jest.spyOn(Animated, 'spring').mockReturnValue({
    start: jest.fn(),
    stop: jest.fn(),
    reset: jest.fn(),
  });
  const stop = jest.spyOn(wallpaperMotion, 'stopAnimation');
  const releaseA = retainWallpaperMotion();
  const releaseB = retainWallpaperMotion();
  expect(DeviceMotion.addListener).toHaveBeenCalledTimes(1);
  const onMotion = jest.mocked(DeviceMotion.addListener).mock.calls[0][0];
  const measurement: Parameters<typeof onMotion>[0] = {
    acceleration: null,
    accelerationIncludingGravity: { x: 0, y: 0, z: 0, timestamp: 0 },
    rotation: { alpha: 0, beta: 0.1, gamma: 0.2, timestamp: 0 },
    rotationRate: null,
    interval: 50,
    orientation: 0,
  };
  onMotion(measurement);
  expect(spring).toHaveBeenCalledTimes(1);
  onMotion(measurement);
  onMotion({ ...measurement, rotation: { ...measurement.rotation!, beta: 0.101 } });
  expect(spring).toHaveBeenCalledTimes(1);
  releaseA();
  releaseA();
  expect(remove).not.toHaveBeenCalled();
  expect(stop).not.toHaveBeenCalled();
  releaseB();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(stop).toHaveBeenCalledTimes(1);
  const releaseC = retainWallpaperMotion();
  expect(DeviceMotion.addListener).toHaveBeenCalledTimes(2);
  releaseC();
  jest.restoreAllMocks();
});

it('ignores a minute of hand tremor at 10 Hz but follows a real tilt', () => {
  jest.spyOn(DeviceMotion, 'addListener').mockReturnValue({ remove: jest.fn() });
  const spring = jest.spyOn(Animated, 'spring').mockReturnValue({
    start: jest.fn(),
    stop: jest.fn(),
    reset: jest.fn(),
  });
  const release = retainWallpaperMotion();
  const onMotion = jest.mocked(DeviceMotion.addListener).mock.calls[0][0];
  const at = (beta: number, gamma: number) =>
    onMotion({
      acceleration: null,
      accelerationIncludingGravity: { x: 0, y: 0, z: 0, timestamp: 0 },
      rotation: { alpha: 0, beta, gamma, timestamp: 0 },
      rotationRate: null,
      interval: 100,
      orientation: 0,
    });
  // Held in a hand: about ±1.5° of tremor around a 30° hold, 600 samples.
  const tremor = 0.026;
  for (let i = 0; i < 600; i++) {
    at(0.52 + tremor * Math.sin(i * 1.7), 0.1 + tremor * Math.cos(i * 2.3));
  }
  // The 0.25 px deadband restarted the spring on almost every sample (> 400).
  expect(spring.mock.calls.length).toBeLessThanOrEqual(5);
  const settled = spring.mock.calls.length;
  at(0.52 + 0.3, 0.1);
  expect(spring).toHaveBeenCalledTimes(settled + 1);
  expect(spring.mock.calls.at(-1)![1]).toMatchObject({ bounciness: 4, speed: 40 });
  release();
  jest.restoreAllMocks();
});
