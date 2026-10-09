/**
 * @jest-environment node
 *
 * Every flow that changes accounts takes this lock and gives it back the same
 * way. What matters is that a lock which is not released refuses every later
 * flow, and that releasing gives back exactly what was taken.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { acquireTransition, isTransitionInFlight } from '@/shared/lib/profile/profileTransition';

jest.mock('@react-native-async-storage/async-storage', () => {
  const data = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => data.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => void data.set(key, value)),
      removeItem: jest.fn(async (key: string) => void data.delete(key)),
    },
  };
});
jest.mock('@/shared/lib/logger', () => ({
  log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));
jest.mock('@/shared/lib/cashu/manager', () => ({ CocoManager: { cleanup: jest.fn() } }));
jest.mock('@/shared/lib/profile/appRestart', () => ({ restartApp: jest.fn() }));
jest.mock('@/shared/stores/runtime/paymentStatusStore', () => ({ usePaymentStatusStore: {} }));
jest.mock('@/shared/stores/runtime/popupStore', () => ({ usePopupStore: {} }));
jest.mock('@/shared/stores/global/profileStore', () => ({
  PROFILE_STORE_PERSIST_VERSION: 1,
  useProfileStore: {},
}));

const GUARD = 'profile-transition-in-progress';

it('is held by one flow at a time and free again after release', async () => {
  const first = acquireTransition();
  expect(first).not.toBeNull();
  expect(acquireTransition()).toBeNull();
  expect(isTransitionInFlight()).toBe(true);

  await first!.release();

  expect(isTransitionInFlight()).toBe(false);
  const second = acquireTransition();
  expect(second).not.toBeNull();
  await second!.release();
});

it('writes the on-disk guard only when asked, and removes it on release', async () => {
  const memoryOnly = acquireTransition()!;
  await memoryOnly.release();
  expect(await AsyncStorage.getItem(GUARD)).toBeNull();

  const lock = acquireTransition()!;
  expect(await lock.takeDiskGuard()).toBe(true);
  expect(await AsyncStorage.getItem(GUARD)).not.toBeNull();

  await lock.release();
  expect(await AsyncStorage.getItem(GUARD)).toBeNull();
});

it('refuses the on-disk guard while another runtime’s transition is recent, and leaves it alone', async () => {
  await AsyncStorage.setItem(GUARD, JSON.stringify({ startedAt: Date.now() }));

  const lock = acquireTransition()!;
  expect(await lock.takeDiskGuard()).toBe(false);
  await lock.release();

  // The guard belongs to the other transition; this lock never took it.
  expect(await AsyncStorage.getItem(GUARD)).not.toBeNull();
  expect(isTransitionInFlight()).toBe(false);
  await AsyncStorage.removeItem(GUARD);
});

it('drops the splash on release only when this flow was holding it', async () => {
  const resetStages = jest.fn();
  const cancelResetStages = jest.fn();

  const quiet = acquireTransition()!;
  await quiet.release();
  expect(cancelResetStages).not.toHaveBeenCalled();

  const lock = acquireTransition()!;
  lock.holdSplash({ resetStages, cancelResetStages }, { holdUntilCancel: true });
  expect(resetStages).toHaveBeenCalledWith({ holdUntilCancel: true });
  await lock.release();
  expect(cancelResetStages).toHaveBeenCalledTimes(1);
});
