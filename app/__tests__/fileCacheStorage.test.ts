/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

import { createFileCacheStorage } from '@/shared/lib/persist/fileCacheStorage';

/**
 * The map cache is over 2 MB. In AsyncStorage on Android that is a row which
 * can be written but never read back, inside a database capped at 6 MB for
 * every store together. These hold that the file-backed store round-trips a
 * value, takes over and frees the row an earlier release left behind, and
 * never ends up with a half-written or out-of-order value.
 */
const mockFiles = new Map<string, string>();
const mockRows = new Map<string, string>();
let mockUnreadableRow = false;
let mockWriteDelays: number[] = [];
let mockFailNextWrite = false;

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'cache/',
  getInfoAsync: jest.fn(async (path: string) => ({ exists: mockFiles.has(path) })),
  readAsStringAsync: jest.fn(async (path: string) => {
    const value = mockFiles.get(path);
    if (value === undefined) throw new Error('missing');
    return value;
  }),
  writeAsStringAsync: jest.fn(async (path: string, value: string) => {
    const delay = mockWriteDelays.shift() ?? 0;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (mockFailNextWrite) {
      mockFailNextWrite = false;
      // Part of the value lands before the failure.
      mockFiles.set(path, value.slice(0, 3));
      throw new Error('disk full');
    }
    mockFiles.set(path, value);
  }),
  deleteAsync: jest.fn(async (path: string) => void mockFiles.delete(path)),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    const value = mockFiles.get(from);
    if (value === undefined) throw new Error('missing');
    mockFiles.delete(from);
    mockFiles.set(to, value);
  }),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => {
      if (mockUnreadableRow) throw new Error('Row too big to fit into CursorWindow');
      return mockRows.get(key) ?? null;
    }),
    setItem: jest.fn(async (key: string, value: string) => void mockRows.set(key, value)),
    removeItem: jest.fn(async (key: string) => void mockRows.delete(key)),
  },
}));
jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), warn: jest.fn() },
  redactError: (error: unknown) => error,
}));

const FILE = 'cache/store-map-cache.json';

beforeEach(() => {
  mockFiles.clear();
  mockRows.clear();
  mockUnreadableRow = false;
  mockWriteDelays = [];
  mockFailNextWrite = false;
  jest.clearAllMocks();
});

it('keeps the value in a file and nothing in AsyncStorage', async () => {
  const storage = createFileCacheStorage();

  await storage.setItem('map-cache', 'places');

  expect(mockFiles.get(FILE)).toBe('places');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  // A new instance, as after a restart, reads it back.
  await expect(createFileCacheStorage().getItem('map-cache')).resolves.toBe('places');
});

it('reads as absent on a fresh install', async () => {
  await expect(createFileCacheStorage().getItem('map-cache')).resolves.toBeNull();
});

it('takes over the row an earlier release wrote, and frees it', async () => {
  mockRows.set('map-cache', 'places from the old release');

  await expect(createFileCacheStorage().getItem('map-cache')).resolves.toBe(
    'places from the old release'
  );

  expect(mockFiles.get(FILE)).toBe('places from the old release');
  // The row no longer counts against the space every other store shares.
  expect(mockRows.has('map-cache')).toBe(false);
});

it('frees an earlier release row that Android cannot read', async () => {
  mockRows.set('map-cache', 'x'.repeat(10));
  mockUnreadableRow = true;

  await expect(createFileCacheStorage().getItem('map-cache')).resolves.toBeNull();

  expect(mockRows.has('map-cache')).toBe(false);
});

it('frees a leftover row even when the file already exists', async () => {
  mockFiles.set(FILE, 'current places');
  mockRows.set('map-cache', 'stale places');

  await expect(createFileCacheStorage().getItem('map-cache')).resolves.toBe('current places');

  expect(mockRows.has('map-cache')).toBe(false);
});

it('keeps the last value saved, whichever write is slower', async () => {
  const storage = createFileCacheStorage();
  // The first write is slow; the second was made later and must win.
  mockWriteDelays = [30, 0];

  await Promise.all([storage.setItem('map-cache', 'older'), storage.setItem('map-cache', 'newer')]);

  expect(mockFiles.get(FILE)).toBe('newer');
});

it('keeps the previous value when a write is cut short', async () => {
  const storage = createFileCacheStorage();
  await storage.setItem('map-cache', 'good value');
  mockFailNextWrite = true;

  await expect(storage.setItem('map-cache', 'never finished')).rejects.toThrow('disk full');

  await expect(storage.getItem('map-cache')).resolves.toBe('good value');
  // A failed write does not stop later ones.
  await storage.setItem('map-cache', 'next value');
  await expect(storage.getItem('map-cache')).resolves.toBe('next value');
});

it('removes the file, a leftover temporary file and any old row', async () => {
  const storage = createFileCacheStorage();
  await storage.setItem('map-cache', 'places');
  mockFiles.set(`${FILE}.tmp`, 'partial');
  mockRows.set('map-cache', 'old row');

  await storage.removeItem('map-cache');

  expect(mockFiles.size).toBe(0);
  expect(mockRows.size).toBe(0);
});

it('does not bring a removed value back from a write made earlier', async () => {
  const storage = createFileCacheStorage();
  mockWriteDelays = [30];

  await Promise.all([storage.setItem('map-cache', 'places'), storage.removeItem('map-cache')]);

  expect(FileSystem.deleteAsync).toHaveBeenCalled();
  expect(mockFiles.has(FILE)).toBe(false);
});
