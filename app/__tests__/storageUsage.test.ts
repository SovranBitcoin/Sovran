/** @jest-environment node */
import { Platform } from 'react-native';

import {
  measureAsyncStorageUsage,
  reportAsyncStorageUsage,
} from '@/shared/lib/persist/storageUsage';
import { storeLog } from '@/shared/lib/logger';

/**
 * Android caps AsyncStorage at 6 MB in total and cannot read back a row over
 * about 2 MB. Saves fail past the cap with nothing on screen, so the app
 * measures how close an install is and says so in its log.
 */
const mockRows = new Map<string, string>();
const mockUnreadable = new Set<string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getAllKeys: jest.fn(async () => [...mockRows.keys()]),
    getItem: jest.fn(async (key: string) => {
      if (mockUnreadable.has(key)) throw new Error('Row too big to fit into CursorWindow');
      return mockRows.get(key) ?? null;
    }),
  },
}));
jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), warn: jest.fn() },
  redactError: (error: unknown) => error,
}));

const pubkey = 'a'.repeat(64);

beforeEach(() => {
  mockRows.clear();
  mockUnreadable.clear();
  jest.clearAllMocks();
  Platform.OS = 'android';
});

it('adds up every row and names the largest without any profile key', async () => {
  mockRows.set('settings-store', 'x'.repeat(100));
  mockRows.set(`mint-store:profile:${pubkey}`, 'y'.repeat(5000));

  const usage = await measureAsyncStorageUsage();

  expect(usage.rows).toBe(2);
  expect(usage.totalChars).toBe(
    'settings-store'.length + 100 + `mint-store:profile:${pubkey}`.length + 5000
  );
  expect(usage.largest[0].store).toBe('mint-store:profile:[id]');
  expect(JSON.stringify(usage)).not.toContain(pubkey);
});

it('never logs an identity carried in a key', async () => {
  const npub = 'npub1' + 'q'.repeat(58);
  mockRows.set(`nip04-cache:v1:${pubkey}`, 'x'.repeat(900));
  mockRows.set(`whitenoise:3:dm-index:${'b'.repeat(64)}`, 'x'.repeat(800));
  mockRows.set(`profile-cache:${npub}`, 'x'.repeat(700));

  const logged = JSON.stringify(await measureAsyncStorageUsage());

  expect(logged).not.toContain(pubkey);
  expect(logged).not.toContain('b'.repeat(64));
  expect(logged).not.toContain(npub);
  expect(logged).toContain('nip04-cache:v1:[id]');
});

it('counts a row it cannot read instead of stopping at it', async () => {
  mockRows.set('map-cache', 'z');
  mockRows.set('settings-store', 'x'.repeat(100));
  mockUnreadable.add('map-cache');

  const usage = await measureAsyncStorageUsage();

  expect(usage.unreadableRows).toBe(1);
  expect(usage.totalChars).toBeGreaterThan(100);
  expect(usage.largest[0]).toEqual({ store: 'map-cache', chars: -1 });
});

it('reports quietly when there is plenty of room', async () => {
  mockRows.set('settings-store', 'x'.repeat(100));

  await reportAsyncStorageUsage();

  expect(storeLog.info).toHaveBeenCalledWith('storage.usage', expect.objectContaining({ rows: 1 }));
  expect(storeLog.warn).not.toHaveBeenCalled();
});

it('warns on Android when the total is close to the cap', async () => {
  for (let i = 0; i < 5; i++) mockRows.set(`store-${i}`, 'x'.repeat(1_000_000));

  await reportAsyncStorageUsage();

  expect(storeLog.warn).toHaveBeenCalledWith(
    'storage.usage.high',
    expect.objectContaining({ capChars: 6 * 1024 * 1024 })
  );
});

it('does not warn about the total on iOS, which has no cap', async () => {
  Platform.OS = 'ios';
  for (let i = 0; i < 5; i++) mockRows.set(`store-${i}`, 'x'.repeat(1_000_000));

  await reportAsyncStorageUsage();

  expect(storeLog.warn).not.toHaveBeenCalled();
});

it('warns on Android about a single row near the size that cannot be read back', async () => {
  mockRows.set('big-cache', 'x'.repeat(1_600_000));

  await reportAsyncStorageUsage();

  expect(storeLog.warn).toHaveBeenCalledWith('storage.usage.high', expect.anything());
});

it('warns when a row is already unreadable', async () => {
  mockRows.set('map-cache', 'z');
  mockUnreadable.add('map-cache');

  await reportAsyncStorageUsage();

  expect(storeLog.warn).toHaveBeenCalledWith(
    'storage.usage.high',
    expect.objectContaining({ unreadableRows: 1 })
  );
});

it('does not read anything when the log would discard the result', async () => {
  const AsyncStorage = jest.requireMock('@react-native-async-storage/async-storage').default;
  (storeLog as unknown as { isLevelEnabled: () => boolean }).isLevelEnabled = () => false;

  await reportAsyncStorageUsage();

  expect(AsyncStorage.getAllKeys).not.toHaveBeenCalled();
  delete (storeLog as unknown as { isLevelEnabled?: unknown }).isLevelEnabled;
});
