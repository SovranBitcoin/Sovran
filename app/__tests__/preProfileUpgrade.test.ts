/**
 * @jest-environment node
 */

/* eslint-disable import/first */

/**
 * Upgrading an install from before profiles existed (0.0.45 to 0.0.56) straight
 * to this build. Such an install has no `profile-store`: its one account's
 * stores are under bare keys and its root phrase is in SecureStore.
 *
 * Synthetic fixtures, not device data. The shapes are what 0.0.56 wrote
 * (99eb79aaa: `stores/routstrStore.ts`, `stores/mintStore.ts`,
 * `stores/scanHistoryStore.ts`, `stores/settingsStore.ts`,
 * `helper/secureStorage.ts`). Keep them fixed when current schemas change.
 */
type StorageMap = Record<string, string>;
let mockStorage: StorageMap = {};
const mockSecureBacking = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStorage[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete mockStorage[key];
  }),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecureBacking.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureBacking.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureBacking.delete(key);
  }),
}));
jest.mock('@/shared/lib/logger', () => {
  const logger = () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return { log: logger(), nostrLog: logger(), redactError: (error: unknown) => error };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { log } from '@/shared/lib/logger';
import { runGlobalMigrations } from '@/shared/lib/migrations/globalMigrations';
import { deriveNostrKeys } from '@/shared/lib/nostr/keyDerivation';
import { useSecureStoreState } from '@/shared/stores/runtime/secureStoreState';

// The NIP-06 test vector, so the expected key does not come from the code under test.
const PHRASE = 'leader monkey parrot ring guide accident before fence cannon height naive bean';
const ACCOUNT_0 = '17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917';
const INVALID_CHECKSUM =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';

const COMPLETED_KEY = 'global-migrations-completed';
const INDEX_MIGRATION = 'index-to-pubkey-keys-v2';
const scoped = (name: string) => `${name}:profile:${ACCOUNT_0}`;
const blob = (state: object) => JSON.stringify({ state, version: 0 });

const ROUTSTR = blob({
  apiKey: 'sk-synthetic-test-credential',
  balance: 21000,
  conversationHistory: [{ id: 'q1', role: 'user', content: 'Hello', timestamp: 1 }],
  selectedModel: 'fixture-model',
  sessions: [
    {
      id: 'session-1',
      title: 'Saved chat',
      createdAt: 1,
      messages: [{ id: 'q1', role: 'user', content: 'Hello', timestamp: 1 }],
    },
  ],
  currentSessionId: 'session-1',
});
const MINT = blob({ selectedMints: { [ACCOUNT_0]: 'https://mint.example/Bitcoin' } });
const SCAN_HISTORY = blob({
  entries: [
    {
      id: 'scan-1',
      raw: 'lightning:lnbc1fixture',
      processed: 'lnbc1fixture',
      type: 'lightning',
      source: 'qr',
      scannedAt: 1,
      transactionId: 'tx-1',
    },
  ],
});
const SETTINGS = blob({
  theme: 'dark',
  language: 'en',
  displayBtc: 3,
  displayCurrency: 'usd',
  experimental: false,
  termsAccepted: { termsAccepted: true, date: '2025-11-01' },
  quickAccessP2PK: false,
  sendLocationEnabled: false,
});
const MOVED = { 'routstr-store': ROUTSTR, 'mint-store': MINT, 'scan-history-store': SCAN_HISTORY };

/** Storage as 0.0.56 left it. */
function preProfileInstall(): StorageMap {
  return {
    ...MOVED,
    'settings-store': SETTINGS,
    'pricelist-store': blob({ pricelist: { usd: 1 }, lastUpdated: 1 }),
    // Not a 0.0.56 key. It stands for a name on the migration's list whose
    // bare key belongs to a global store today.
    'own-profile-stats-cache': blob({ entries: {} }),
  };
}

/** What the keys provider does once it has derived account 0. */
function addAccountZeroRow(): void {
  mockStorage['profile-store'] = JSON.stringify({
    state: {
      activeAccountIndex: 0,
      profiles: [{ accountIndex: 0, pubkey: ACCOUNT_0, addedAt: 1 }],
    },
    version: 2,
  });
}

const completed = (): string[] => JSON.parse(mockStorage[COMPLETED_KEY] ?? '[]');
const withoutMarker = ({ [COMPLETED_KEY]: _marker, ...rest }: StorageMap) => rest;

beforeEach(() => {
  mockStorage = {};
  mockSecureBacking.clear();
  jest.clearAllMocks();
  jest
    .mocked(SecureStore.getItemAsync)
    .mockImplementation(async (key) => mockSecureBacking.get(key) ?? null);
  useSecureStoreState.setState({ secureStoreState: 'available', errorName: null });
});

it('derives the pubkey the keys provider will give account 0', () => {
  expect(deriveNostrKeys(PHRASE, 0).pubkey).toBe(ACCOUNT_0);
});

describe('first launch after 0.0.56', () => {
  beforeEach(() => {
    mockStorage = preProfileInstall();
    mockSecureBacking.set('user_mnemonic', PHRASE);
  });

  it("copies each bare store to account 0's key byte for byte", async () => {
    await expect(runGlobalMigrations()).resolves.toBeUndefined();

    for (const [name, value] of Object.entries(MOVED)) {
      expect(mockStorage[scoped(name)]).toBe(value);
    }
  });

  it('keeps the bare keys for stores that load before account 0 has a row', async () => {
    await runGlobalMigrations();

    for (const [name, value] of Object.entries(MOVED)) expect(mockStorage[name]).toBe(value);
    // Not recorded, so the next launch comes back to remove them.
    expect(completed()).not.toContain(INDEX_MIGRATION);
  });

  it('leaves global stores and the keychain alone', async () => {
    const before = preProfileInstall();

    await runGlobalMigrations();

    expect(mockStorage['pricelist-store']).toBe(before['pricelist-store']);
    expect(mockStorage['own-profile-stats-cache']).toBe(before['own-profile-stats-cache']);
    expect(mockStorage[scoped('own-profile-stats-cache')]).toBeUndefined();
    expect(mockStorage[scoped('settings-store')]).toBeUndefined();
    expect(mockStorage['profile-store']).toBeUndefined();
    expect([...mockSecureBacking]).toEqual([['user_mnemonic', PHRASE]]);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('changes nothing when run again before the account exists', async () => {
    await runGlobalMigrations();
    const afterFirst = { ...mockStorage };
    jest.mocked(AsyncStorage.setItem).mockClear();
    jest.mocked(AsyncStorage.removeItem).mockClear();

    await expect(runGlobalMigrations()).resolves.toBeUndefined();

    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    expect(mockStorage).toEqual(afterFirst);
  });

  it('does not replace data already saved under the account', async () => {
    const newer = blob({ selectedMint: 'https://newer.example' });
    mockStorage[scoped('mint-store')] = newer;

    await runGlobalMigrations();

    expect(mockStorage[scoped('mint-store')]).toBe(newer);
    expect(mockStorage[scoped('routstr-store')]).toBe(ROUTSTR);
  });

  it('stops when a copy fails and finishes on a retry', async () => {
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));

    await expect(runGlobalMigrations()).rejects.toThrow('disk full');
    for (const [name, value] of Object.entries(MOVED)) expect(mockStorage[name]).toBe(value);

    await expect(runGlobalMigrations()).resolves.toBeUndefined();
    for (const [name, value] of Object.entries(MOVED)) {
      expect(mockStorage[scoped(name)]).toBe(value);
    }
  });
});

describe('second launch, once account 0 has its row', () => {
  beforeEach(async () => {
    mockStorage = preProfileInstall();
    mockSecureBacking.set('user_mnemonic', PHRASE);
    await runGlobalMigrations();
    addAccountZeroRow();
  });

  it('removes the bare keys and keeps what the account holds', async () => {
    // Saved during the first session, after the copy.
    const savedSince = blob({ selectedMint: 'https://mint.example/Bitcoin' });
    mockStorage[scoped('mint-store')] = savedSince;

    await expect(runGlobalMigrations()).resolves.toBeUndefined();

    for (const name of Object.keys(MOVED)) expect(mockStorage[name]).toBeUndefined();
    expect(mockStorage[scoped('routstr-store')]).toBe(ROUTSTR);
    expect(mockStorage[scoped('scan-history-store')]).toBe(SCAN_HISTORY);
    expect(mockStorage[scoped('mint-store')]).toBe(savedSince);
    expect(mockStorage['own-profile-stats-cache']).toBe(blob({ entries: {} }));
    expect(completed()).toContain(INDEX_MIGRATION);
  });

  it('is finished: a third launch touches nothing', async () => {
    await runGlobalMigrations();
    const settled = { ...mockStorage };
    jest.mocked(AsyncStorage.setItem).mockClear();
    jest.mocked(AsyncStorage.removeItem).mockClear();
    jest.mocked(SecureStore.getItemAsync).mockClear();

    await expect(runGlobalMigrations()).resolves.toBeUndefined();

    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    expect(mockStorage).toEqual(settled);
  });
});

it('writes only the completion marker on a fresh install, without reading the keychain', async () => {
  await expect(runGlobalMigrations()).resolves.toBeUndefined();

  expect(Object.keys(mockStorage)).toEqual([COMPLETED_KEY]);
  expect(completed()).toContain(INDEX_MIGRATION);
  expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
});

describe('when the phrase cannot be used', () => {
  // The settings theme is stripped by a later migration; these compare the rest.
  const accountData = (storage: StorageMap) => {
    const { 'settings-store': _settings, ...rest } = withoutMarker(storage);
    return rest;
  };

  it.each([
    [
      'is unreadable',
      () => jest.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error('x')),
    ],
    ['is missing', () => {}],
    ['fails its checksum', () => void mockSecureBacking.set('user_mnemonic', INVALID_CHECKSUM)],
  ])('leaves every bare key in place and does not throw when it %s', async (_case, arrange) => {
    mockStorage = preProfileInstall();
    arrange();

    await expect(runGlobalMigrations()).resolves.toBeUndefined();

    expect(accountData(mockStorage)).toEqual(accountData(preProfileInstall()));
    expect(log.warn).toHaveBeenCalledWith('migrations.global.pre_profile.phrase_unavailable', {
      storeCount: Object.keys(MOVED).length,
    });
    // Not recorded: the keychain may only be unreadable for now, and a
    // migration marked done would leave these stores behind once it reads.
    expect(completed()).not.toContain(INDEX_MIGRATION);
  });

  it('copies on the next launch once the keychain can be read again', async () => {
    mockStorage = preProfileInstall();
    mockSecureBacking.set('user_mnemonic', PHRASE);
    jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('x'));
    await runGlobalMigrations();
    const afterFailedLaunch = accountData(mockStorage);
    expect(afterFailedLaunch).toEqual(accountData(preProfileInstall()));

    await runGlobalMigrations();
    const scoped = Object.keys(mockStorage).filter((key) => key.includes(':profile:'));
    expect(scoped).toHaveLength(Object.keys(MOVED).length);
  });
});
