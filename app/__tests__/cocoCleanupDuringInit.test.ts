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
