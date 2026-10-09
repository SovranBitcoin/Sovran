import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { createCashuSeedGetter } from 'wallet';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { createSovranCocoRepositories } from '@/shared/lib/cashu/cocoRepositories';

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

type Staged = {
  signerKey: Uint8Array | null;
  cashuMnemonic: string | null;
  isImportedProfile: boolean;
};
/** The credentials staged for the next initialise; private, read here only. */
const staged = () => CocoManager as unknown as Staged;

let failOpen!: (error: Error) => void;
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Start an initialise that is parked on the database open. */
async function startParkedInitialise() {
  jest.mocked(SQLite.openDatabaseAsync).mockReturnValue(
    new Promise((_resolve, reject) => {
      failOpen = reject;
    })
  );
  const initialising = CocoManager.initialize().catch((error: Error) => error);
  await tick();
  // Wrapped: returning the promise itself would make this wait for it.
  return { initialising };
}

beforeEach(() => {
  jest.mocked(SQLite.openDatabaseAsync).mockReset();
  jest.mocked(SQLite.deleteDatabaseAsync).mockClear();
  jest.mocked(createCashuSeedGetter).mockReset();
  CocoManager.setAccountIndex(0);
  CocoManager.setCashuMnemonic('phrase of account a');
  CocoManager.setSignerKey(new Uint8Array(32).fill(1));
});

/**
 * A provider that unmounts while the wallet is still opening calls cleanup.
 * Cleanup used to find no instance and return at once; the initialise then
 * finished and left a live wallet, opened for the account that was current
 * when it started, with nothing left to close it.
 */
it('waits for an initialise in flight instead of reporting a closed wallet', async () => {
  const { initialising } = await startParkedInitialise();
  expect(SQLite.openDatabaseAsync).toHaveBeenCalledTimes(1);

  let cleaned = false;
  const cleaning = CocoManager.cleanup().then(() => {
    cleaned = true;
  });
  await tick();
  expect(cleaned).toBe(false);
  // The initialise is still reading these.
  expect(staged().cashuMnemonic).toBe('phrase of account a');

  failOpen(new Error('open failed'));
  await initialising;
  await cleaning;

  expect(cleaned).toBe(true);
  expect(CocoManager.peekInstance()).toBeNull();
  expect(staged().signerKey).toBeNull();
  expect(staged().cashuMnemonic).toBeNull();
});

it('keeps the credentials a remounted provider staged while the old wallet was closing', async () => {
  const { initialising } = await startParkedInitialise();
  const cleaning = CocoManager.cleanup();
  await tick();

  // The next provider mounts before the old wallet has finished closing.
  CocoManager.setAccountIndex(3, true);
  CocoManager.setCashuMnemonic('phrase of account b');
  CocoManager.setSignerKey(new Uint8Array(32).fill(2));

  failOpen(new Error('open failed'));
  await initialising;
  await cleaning;

  // Clearing these would open account b's wallet without its key, and treat
  // an imported account as a derived one.
  expect(staged().cashuMnemonic).toBe('phrase of account b');
  expect(staged().signerKey).toEqual(new Uint8Array(32).fill(2));
  expect(staged().isImportedProfile).toBe(true);
});

it('does not hand the old signer key to a provider that staged none', async () => {
  const { initialising } = await startParkedInitialise();
  const cleaning = CocoManager.cleanup();
  await tick();

  CocoManager.setAccountIndex(3);
  CocoManager.setCashuMnemonic('phrase of account b');

  failOpen(new Error('open failed'));
  await initialising;
  await cleaning;

  expect(staged().cashuMnemonic).toBe('phrase of account b');
  expect(staged().signerKey).toBeNull();
});

it('pairs a wallet database with the identity staged when its initialise began', async () => {
  let finishOpen!: (db: unknown) => void;
  jest.mocked(SQLite.openDatabaseAsync).mockReturnValue(
    new Promise((resolve) => {
      finishOpen = resolve as (db: unknown) => void;
    })
  );
  // Only `init` is reached before the seed getter is built.
  const repositories = createSovranCocoRepositories as jest.Mock;
  repositories.mockReturnValue({ init: async () => undefined });
  const initialising = CocoManager.initialize().catch((error: Error) => error);
  await tick();
  expect(SQLite.openDatabaseAsync).toHaveBeenCalledWith('coco.db');

  // Another account is staged while account a's database is still opening.
  CocoManager.setAccountIndex(3, true);
  CocoManager.setCashuMnemonic('phrase of account b');

  finishOpen({
    getAllAsync: async () => [],
    getFirstAsync: async () => null,
    execAsync: async () => undefined,
    runAsync: async () => undefined,
    closeAsync: async () => undefined,
  });
  for (let i = 0; i < 20 && !jest.mocked(createCashuSeedGetter).mock.calls.length; i++) {
    await tick();
  }

  // The seed for coco.db must come from account a's phrase, never account b's.
  const [seedOptions] = jest.mocked(createCashuSeedGetter).mock.calls[0];
  await expect(seedOptions.getMnemonic()).resolves.toBe('phrase of account a');

  await initialising;
  await CocoManager.cleanup();
});

it('makes delete-all wait for a wallet that is still opening', async () => {
  const { initialising } = await startParkedInitialise();

  let reset = false;
  const resetting = CocoManager.completeReset([0]).then(() => {
    reset = true;
  });
  await tick();
  // Deleting now would let the initialise recreate the database afterwards.
  expect(reset).toBe(false);
  expect(SQLite.deleteDatabaseAsync).not.toHaveBeenCalled();

  failOpen(new Error('open failed'));
  await initialising;
  await resetting;

  expect(SQLite.deleteDatabaseAsync).toHaveBeenCalledWith('coco.db');
});

it('does not let a wallet that was opening come back after delete-all', async () => {
  let finishOpen!: (db: unknown) => void;
  jest.mocked(SQLite.openDatabaseAsync).mockReturnValue(
    new Promise((resolve) => {
      finishOpen = resolve as (db: unknown) => void;
    })
  );
  const closeAsync = jest.fn(async () => undefined);
  const initialising = CocoManager.initialize().catch((error: Error) => error);
  await tick();

  const resetting = CocoManager.completeReset([0]);
  await tick();
  // The open finishes after the reset began.
  finishOpen({
    getAllAsync: async () => [],
    getFirstAsync: async () => null,
    execAsync: async () => undefined,
    runAsync: async () => undefined,
    closeAsync,
  });

  const outcome = await initialising;
  await resetting;

  expect(outcome).toBeInstanceOf(Error);
  expect((outcome as Error).message).toMatch(/reset while it was opening/);
  expect(closeAsync).toHaveBeenCalled();
  expect(CocoManager.peekInstance()).toBeNull();
  expect(SQLite.deleteDatabaseAsync).toHaveBeenCalledWith('coco.db');
});

it('reports a delete-all that could not remove a wallet database', async () => {
  jest.mocked(SQLite.deleteDatabaseAsync).mockRejectedValueOnce(new Error('database is open'));
  jest.mocked(FileSystem.deleteAsync).mockRejectedValueOnce(new Error('permission denied'));

  // Reporting success here would clear the keys and leave the proofs on disk.
  await expect(CocoManager.completeReset([0])).rejects.toThrow('permission denied');
});
