import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { CocoManager } from '@/shared/lib/cashu/manager';

jest.mock('expo-sqlite', () => ({
  deleteDatabaseAsync: jest.fn().mockResolvedValue(undefined),
  openDatabaseAsync: jest.fn(),
}));

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  copyAsync: jest.fn().mockResolvedValue(undefined),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
  readDirectoryAsync: jest.fn().mockResolvedValue([]),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(false),
  shareAsync: jest.fn(),
}));

jest.mock('coco-cashu-plugin-npc', () => ({
  NPCPlugin: class NPCPlugin {},
}));

jest.mock('@sovranbitcoin/coco-cashu-plugin-p2pk-import', () => ({
  createP2PKImportPlugin: jest.fn(() => ({})),
}));

jest.mock('wallet', () => ({
  createCashuSeedGetter: jest.fn(),
  deriveStandardCashuSeed: jest.fn(),
}));

jest.mock('@/shared/lib/nostr/secureStorage', () => ({
  retrieveMnemonic: jest.fn(),
  retrieveCashuSeed: jest.fn(),
  storeCashuSeed: jest.fn(),
  hashMnemonic: jest.fn(),
}));

jest.mock('@/shared/lib/nostr/keyDerivation', () => ({
  deriveNostrKeys: jest.fn(),
  deriveCashuMnemonic: jest.fn(),
  deriveCashuMnemonicForImported: jest.fn(),
}));

jest.mock('@/shared/lib/cashu/cocoRepositories', () => ({
  createSovranCocoRepositories: jest.fn(),
}));

jest.mock('@/shared/lib/cashu/managerInternals', () => ({
  getInflightProofs: jest.fn(),
  restoreProofsToReady: jest.fn(),
}));

jest.mock('@/shared/lib/cashu/npc', () => ({
  NPC_BASE_URL: 'https://npub.cash',
  NPC_SYNC_INTERVAL_MS: 60_000,
  AsyncStorageSinceStore: class AsyncStorageSinceStore {},
  getNpcSinceStoreKey: jest.fn(() => 'npc-since'),
}));

describe('CocoManager pre-v2 backup lifecycle', () => {
  it('completeReset deletes the pre-v2 backup set for every profile database', async () => {
    await CocoManager.completeReset([0, 2]);

    expect(SQLite.deleteDatabaseAsync).toHaveBeenCalledWith('coco.db');
    expect(SQLite.deleteDatabaseAsync).toHaveBeenCalledWith('coco-2.db');

    const deletedPaths = (FileSystem.deleteAsync as jest.Mock).mock.calls.map((call) => call[0]);
    expect(deletedPaths).toEqual(
      expect.arrayContaining([
        'file:///docs/SQLite/coco.db.pre-v2',
        'file:///docs/SQLite/coco.db.pre-v2-wal',
        'file:///docs/SQLite/coco.db.pre-v2-shm',
        'file:///docs/SQLite/coco-2.db.pre-v2',
        'file:///docs/SQLite/coco-2.db.pre-v2-wal',
        'file:///docs/SQLite/coco-2.db.pre-v2-shm',
      ])
    );
  });

  /** The SQLite directory exists; no file in it is reported as left behind. */
  const directoryExists = () =>
    jest
      .mocked(FileSystem.getInfoAsync)
      .mockImplementation(
        async (path: string) => ({ exists: path.endsWith('SQLite/') }) as FileSystem.FileInfo
      );
  afterEach(() =>
    jest.mocked(FileSystem.getInfoAsync).mockResolvedValue({ exists: false } as FileSystem.FileInfo)
  );

  it('completeReset deletes every wallet database on the phone, listed or not', async () => {
    directoryExists();
    jest.mocked(SQLite.deleteDatabaseAsync).mockClear();
    // Account 7 has only a journal left; account 9 only a pre-v2 backup; and
    // neither is in the account list any more.
    jest
      .mocked(FileSystem.readDirectoryAsync)
      .mockResolvedValueOnce([
        'coco.db',
        'coco-7.db-wal',
        'coco-9.db.pre-v2',
        'coco-export.db',
        'cocoa.db',
        'nostr',
        'other.db',
      ]);

    await CocoManager.completeReset([0]);

    expect(FileSystem.readDirectoryAsync).toHaveBeenCalledWith('file:///docs/SQLite/');
    const deleted = jest.mocked(SQLite.deleteDatabaseAsync).mock.calls.map(([name]) => name);
    expect(deleted.sort()).toEqual(['coco-7.db', 'coco-9.db', 'coco.db']);
    const paths = jest.mocked(FileSystem.deleteAsync).mock.calls.map(([path]) => path);
    expect(paths).toEqual(expect.arrayContaining(['file:///docs/SQLite/coco-9.db.pre-v2']));
  });

  it('completeReset deletes the listed databases and then reports a directory it could not list', async () => {
    directoryExists();
    jest.mocked(SQLite.deleteDatabaseAsync).mockClear();
    jest
      .mocked(FileSystem.readDirectoryAsync)
      .mockRejectedValueOnce(new Error('permission denied'));

    // What the directory holds is unknown, so the wipe must not report success.
    await expect(CocoManager.completeReset([0, 2])).rejects.toThrow(
      'Wallet databases could not be listed'
    );

    const deleted = jest.mocked(SQLite.deleteDatabaseAsync).mock.calls.map(([name]) => name);
    expect(deleted.sort()).toEqual(['coco-2.db', 'coco.db']);
  });

  it('completeReset takes a missing directory for no databases', async () => {
    jest.mocked(SQLite.deleteDatabaseAsync).mockClear();
    jest.mocked(FileSystem.readDirectoryAsync).mockClear();

    await CocoManager.completeReset([0]);

    expect(FileSystem.readDirectoryAsync).not.toHaveBeenCalled();
    expect(jest.mocked(SQLite.deleteDatabaseAsync).mock.calls.map(([name]) => name)).toEqual([
      'coco.db',
    ]);
  });
});
