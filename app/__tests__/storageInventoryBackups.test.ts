import { getStorageInventorySnapshot } from '@/shared/lib/debug/storageInventory';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getAllKeys: jest.fn().mockResolvedValue([]),
  multiGet: jest.fn().mockResolvedValue([]),
}));

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  readDirectoryAsync: jest
    .fn()
    .mockResolvedValue([
      'coco.db',
      'coco.db-wal',
      'coco-2.db',
      'coco.db.pre-v2',
      'coco.db.pre-v2-wal',
      'coco-2.db.pre-v2',
      'other.db',
    ]),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
}));

describe('storage inventory coco backup classification', () => {
  it('lists live coco dbs separately from pre-v2 migration backups', async () => {
    const snapshot = await getStorageInventorySnapshot([]);

    expect(snapshot.cocoDatabases).toEqual(['coco-2.db', 'coco.db', 'coco.db-wal']);
    expect(snapshot.cocoBackups).toEqual([
      'coco-2.db.pre-v2',
      'coco.db.pre-v2',
      'coco.db.pre-v2-wal',
    ]);
  });
});
