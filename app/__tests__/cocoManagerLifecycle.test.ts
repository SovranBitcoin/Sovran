/**
 * How the wallet manager opens, is ready and closes, seen from its callers:
 * `initialize`, `cleanup`, `isInitialized` and `peekInstance`. The database
 * and the plugins are stand-ins; the coco Manager is the real one.
 */
import { Manager } from '@cashu/coco-core';
import * as SQLite from 'expo-sqlite';
import { getPublicKey } from 'nostr-tools/pure';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { createSovranCocoRepositories } from '@/shared/lib/cashu/cocoRepositories';
import { useProfileStore } from '@/shared/stores/global/profileStore';

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

const openDatabase = SQLite.openDatabaseAsync as jest.Mock;
const repositories = createSovranCocoRepositories as jest.Mock;
const SIGNER_KEY = new Uint8Array(32).fill(1);
const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A database handle that records how often it is closed. */
function database() {
  return {
    getAllAsync: async () => [],
    getFirstAsync: async () => ({ c: 0 }),
    execAsync: async () => undefined,
    runAsync: async () => undefined,
    closeAsync: jest.fn(async (): Promise<void> => undefined),
  };
}
type Database = ReturnType<typeof database>;

/** Every database the manager opens, in order. */
let opened: Database[] = [];

beforeEach(() => {
  opened = [];
  openDatabase.mockReset();
  openDatabase.mockImplementation(async () => {
    const db = database();
    opened.push(db);
    return db;
  });
  repositories.mockReset();
  repositories.mockReturnValue({ init: async () => undefined });
  useProfileStore.setState({
    activeAccountIndex: 0,
    profiles: [{ accountIndex: 0, pubkey: getPublicKey(SIGNER_KEY), addedAt: 1 }],
  });
  CocoManager.setAccountIndex(0);
  CocoManager.setCashuMnemonic('phrase of account a');
  CocoManager.setSignerKey(SIGNER_KEY);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await CocoManager.cleanup();
});

const closes = () => opened.reduce((n, db) => n + db.closeAsync.mock.calls.length, 0);

describe('opening', () => {
  it('shares one open between callers that ask while the database opens', async () => {
    const first = CocoManager.initialize();
    const second = CocoManager.initialize();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(openDatabase).toHaveBeenCalledTimes(1);
  });

  it('hands an open wallet back without opening again', async () => {
    const wallet = await CocoManager.initialize();
    expect(await CocoManager.initialize()).toBe(wallet);
    expect(CocoManager.isInitialized()).toBe(true);
    expect(CocoManager.peekInstance()).toBe(wallet);
    expect(openDatabase).toHaveBeenCalledTimes(1);
  });

  it('opens again after a database open that failed', async () => {
    openDatabase.mockRejectedValueOnce(new Error('disk full'));
    await expect(CocoManager.initialize()).rejects.toThrow('disk full');
    expect(CocoManager.isInitialized()).toBe(false);

    await expect(CocoManager.initialize()).resolves.toBeDefined();
    expect(openDatabase).toHaveBeenCalledTimes(2);
  });
});

describe('closing', () => {
  it('closes the database once, and the next open is a new wallet', async () => {
    const wallet = await CocoManager.initialize();
    await CocoManager.cleanup();
    expect(CocoManager.isInitialized()).toBe(false);
    expect(CocoManager.peekInstance()).toBeNull();
    expect(closes()).toBe(1);

    CocoManager.setCashuMnemonic('phrase of account a');
    CocoManager.setSignerKey(SIGNER_KEY);
    const next = await CocoManager.initialize();
    expect(next).not.toBe(wallet);
    expect(openDatabase).toHaveBeenCalledTimes(2);
  });

  it('makes an open that asks during a close wait for the database to close', async () => {
    await CocoManager.initialize();
    const closed = deferred();
    opened[0].closeAsync.mockImplementationOnce(() => closed.promise);
    const closing = CocoManager.cleanup();
    await tick();

    const opening = CocoManager.initialize();
    await tick();
    expect(openDatabase).toHaveBeenCalledTimes(1);

    closed.resolve();
    await closing;
    await opening;
    expect(openDatabase).toHaveBeenCalledTimes(2);
  });

  it('reports a database that would not close to a caller that needs the close', async () => {
    await CocoManager.initialize();
    opened[0].closeAsync.mockRejectedValueOnce(new Error('database is locked'));
    await expect(CocoManager.cleanup({ requireSuccess: true })).rejects.toThrow(
      'Coco teardown incomplete'
    );
    expect(CocoManager.peekInstance()).toBeNull();
  });

  it('waits for an open in flight and closes what it opened', async () => {
    const opening = CocoManager.initialize();
    const closing = CocoManager.cleanup();
    await opening;
    await closing;
    expect(CocoManager.peekInstance()).toBeNull();
    expect(closes()).toBe(1);
  });
});

// The wallet is ready once its plugins have started, and a start that
// failed is not handed to anyone.
describe('starting the plugins', () => {
  it('is not ready, and hands nobody the wallet, until its plugins have started', async () => {
    const started = deferred();
    jest.spyOn(Manager.prototype, 'initPlugins').mockImplementationOnce(() => started.promise);
    const first = CocoManager.initialize();
    for (let i = 0; i < 20 && opened.length === 0; i++) await tick();
    await tick();

    let joined = false;
    const second = CocoManager.initialize().then((wallet) => {
      joined = true;
      return wallet;
    });
    await tick();
    expect(CocoManager.isInitialized()).toBe(false);
    expect(CocoManager.peekInstance()).toBeNull();
    expect(joined).toBe(false);

    started.resolve();
    expect(await second).toBe(await first);
    expect(CocoManager.isInitialized()).toBe(true);
  });

  it('closes a wallet whose plugins failed to start, and opens a new one next time', async () => {
    const dispose = jest.spyOn(Manager.prototype, 'dispose');
    jest.spyOn(Manager.prototype, 'initPlugins').mockRejectedValueOnce(new Error('plugin failed'));
    await expect(CocoManager.initialize()).rejects.toThrow('plugin failed');
    expect(CocoManager.isInitialized()).toBe(false);
    expect(CocoManager.peekInstance()).toBeNull();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(opened[0].closeAsync).toHaveBeenCalledTimes(1);

    const wallet = await CocoManager.initialize();
    expect(openDatabase).toHaveBeenCalledTimes(2);
    expect(CocoManager.peekInstance()).toBe(wallet);
  });
});

// Whatever an open acquired is closed when the open fails, so no
// database handle is left outside the manager's reach.
describe('an open that fails after the database opened', () => {
  it('closes the database, and the next open opens it again', async () => {
    repositories.mockReturnValueOnce({
      init: async () => {
        throw new Error('migration failed');
      },
    });
    await expect(CocoManager.initialize()).rejects.toThrow('migration failed');
    expect(opened[0].closeAsync).toHaveBeenCalledTimes(1);

    await CocoManager.cleanup();
    expect(opened[0].closeAsync).toHaveBeenCalledTimes(1);

    CocoManager.setCashuMnemonic('phrase of account a');
    CocoManager.setSignerKey(SIGNER_KEY);
    await expect(CocoManager.initialize()).resolves.toBeDefined();
    expect(openDatabase).toHaveBeenCalledTimes(2);
  });
});
