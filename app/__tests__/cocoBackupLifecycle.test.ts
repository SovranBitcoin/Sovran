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
});
