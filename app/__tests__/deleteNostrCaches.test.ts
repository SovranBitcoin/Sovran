/**
 * @jest-environment node
 *
 * Delete-all removes every Nostr cache database on the phone. One left behind
 * for an account no longer in the list would be opened by the next identity
 * made at that account's index.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { deleteNostrCaches } from '@/shared/lib/profile/profileRemovalStorage';

const mockDeleted: string[] = [];
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  readDirectoryAsync: jest.fn(),
  deleteAsync: jest.fn(async (path: string) => void mockDeleted.push(path)),
  // The SQLite directory exists; no file in it is reported as left behind.
  getInfoAsync: jest.fn(async (path: string) => ({ exists: path.endsWith('SQLite/') })),
}));
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  };
  return { __esModule: true, default: storage, ...storage };
});

const databases = () => [
  ...new Set(
    mockDeleted
      .map((path) => path.replace('file:///docs/SQLite/', ''))
      .map((file) => file.replace(/(-journal|-wal|-shm|\.pre-v2.*)$/, ''))
  ),
];

beforeEach(() => {
  mockDeleted.length = 0;
});

it('deletes the caches of listed accounts and of any other account found on disk', async () => {
  jest
    .mocked(FileSystem.readDirectoryAsync)
    .mockResolvedValueOnce([
      'nostr',
      'nostr-4',
      'nostr-9-wal',
      'nostrum',
      'nostr-cache.json',
      'coco.db',
    ]);

  await deleteNostrCaches([0, 1]);

  expect(FileSystem.readDirectoryAsync).toHaveBeenCalledWith('file:///docs/SQLite/');
  expect(databases().sort()).toEqual(['nostr', 'nostr-1', 'nostr-4', 'nostr-9']);
});

it('deletes the listed caches and then reports a directory it could not list', async () => {
  jest.mocked(FileSystem.readDirectoryAsync).mockRejectedValueOnce(new Error('permission denied'));

  await expect(deleteNostrCaches([0, 3])).rejects.toThrow('Nostr caches could not be listed');

  expect(databases().sort()).toEqual(['nostr', 'nostr-3']);
});
