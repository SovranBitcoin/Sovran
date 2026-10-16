import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { getPublicKey } from 'nostr-tools/pure';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { createSovranCocoRepositories } from '@/shared/lib/cashu/cocoRepositories';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
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
jest.mock('coco-cashu-plugin-npc', () => ({ NPCPlugin: class NPCPlugin {} }));
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

// Typed loosely: only the calls the manager makes on them are stubbed.
const openDatabase = SQLite.openDatabaseAsync as jest.Mock;
const getInfo = FileSystem.getInfoAsync as jest.Mock;
const repositories = createSovranCocoRepositories as jest.Mock;

// The wallet refuses to open under a signer key that is not the saved row's,
// so account 0's row carries the public key of the key staged below.
const SIGNER_KEY = new Uint8Array(32).fill(1);
const A = getPublicKey(SIGNER_KEY);
const B = 'b'.repeat(64);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const status = () => useWalletLifecycleStore.getState().restoreStatus;
const row = (accountIndex: number) =>
  useProfileStore.getState().profiles.find((p) => p.accountIndex === accountIndex);

/** What the restore status was when the migrations began to fill the database. */
let statusAtMigration: string | null = null;

/** Open the staged account's wallet over a database with these tables. */
async function openWallet(tables: string[]) {
  openDatabase.mockResolvedValue({
    getAllAsync: async (sql: string) =>
      sql.includes('sqlite_master') ? tables.map((name) => ({ name })) : [],
    getFirstAsync: async () => ({ c: tables.length }),
    execAsync: async () => undefined,
    runAsync: async () => undefined,
    closeAsync: async () => undefined,
  });
  const outcome = await CocoManager.initialize().catch((error: Error) => error);
  await tick();
  await CocoManager.cleanup();
  return outcome;
}
const MIGRATED = ['coco_cashu_migrations', 'coco_cashu_canonical_mint_quotes', 'coco_cashu_proofs'];

beforeEach(async () => {
  await AsyncStorage.clear();
  statusAtMigration = null;
  openDatabase.mockReset();
  getInfo.mockResolvedValue({ exists: false });
  repositories.mockReturnValue({
    init: async () => {
      statusAtMigration = status();
    },
  });
  useProfileStore.setState({
    activeAccountIndex: 0,
    profiles: [
      { accountIndex: 0, pubkey: A, addedAt: 1 },
      { accountIndex: 1, pubkey: B, addedAt: 2 },
    ],
  });
  useWalletLifecycleStore.setState({ seedCreatedAt: 5, restoreStatus: 'complete' });
  CocoManager.setAccountIndex(0);
  CocoManager.setCashuMnemonic('phrase of account a');
  CocoManager.setSignerKey(SIGNER_KEY);
});

it('records an account once its wallet has opened', async () => {
  expect(await openWallet(MIGRATED)).not.toBeInstanceOf(Error);
  expect(row(0)?.walletDatabaseCreated).toBe(true);
  expect(status()).toBe('complete');
});

it('records only the account it opened, and saves nothing for the others', async () => {
  // A later save of the list for another account could undo a switch that
  // had just changed the active account on disk.
  await openWallet(MIGRATED);
  expect(row(0)?.walletDatabaseCreated).toBe(true);
  expect(row(1)?.walletDatabaseCreated).toBeUndefined();
  expect(SQLite.openDatabaseAsync).toHaveBeenCalledTimes(1);
});

it('opens a first, empty database without asking for a restore', async () => {
  await openWallet([]);
  expect(status()).toBe('complete');
  expect(row(0)?.walletDatabaseCreated).toBe(true);
});

it('asks for a restore when a recorded account opens on an empty database', async () => {
  await openWallet(MIGRATED);
  expect(status()).toBe('complete');

  // The file is gone, so SQLite hands back a new database with no tables.
  await openWallet([]);

  expect(status()).toBe('pending');
  // Decided before the migrations ran: afterwards the database has its tables
  // and a retry of a failed start could no longer tell.
  expect(statusAtMigration).toBe('pending');
});

it('still asks when the wallet then fails to start', async () => {
  await openWallet(MIGRATED);
  repositories.mockReturnValue({
    init: async () => {
      throw new Error('migration failed');
    },
  });

  expect(await openWallet([])).toBeInstanceOf(Error);

  expect(status()).toBe('pending');
});

it('does not ask for the other account, whose database was never recorded', async () => {
  await openWallet(MIGRATED);
  CocoManager.setAccountIndex(1);
  CocoManager.setCashuMnemonic('phrase of account b');

  await openWallet([]);

  expect(SQLite.openDatabaseAsync).toHaveBeenLastCalledWith('coco-1.db');
  expect(status()).toBe('complete');
});
