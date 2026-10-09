/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { runGlobalMigrations } from '@/shared/lib/migrations/globalMigrations';

/**
 * The runner's own contract, separate from what each migration does: a failure
 * stops the run and is reported, so `GlobalMigrationGate` keeps profile storage
 * closed. Carrying on would let stores load defaults and write them over keys a
 * half-finished migration was still moving.
 */
type StorageMap = Record<string, string>;
let mockStorage: StorageMap = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStorage[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete mockStorage[key];
  }),
}));
jest.mock('@/shared/lib/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const COMPLETED_KEY = 'global-migrations-completed';
const ALL_MIGRATIONS = [
  'index-to-pubkey-keys-v2',
  'legacy-global-theme-to-profile-v1',
  'wallet-lifecycle-stamp-existing-users-v1',
];
const pubkey0 = 'a'.repeat(64);
const pubkey1 = 'b'.repeat(64);
const blob = (state: object, version = 0) => JSON.stringify({ state, version });

/** Storage as an index-keyed release left it: account 0 on bare keys. */
function indexKeyedInstall(): StorageMap {
  return {
    'profile-store': blob({
      activeAccountIndex: 0,
      profiles: [
        { accountIndex: 0, pubkey: pubkey0, addedAt: 1 },
        { accountIndex: 1, pubkey: pubkey1, addedAt: 2 },
      ],
    }),
    'settings-store': blob({ hasSeenOnboarding: true }),
    'mint-store': blob({ mints: ['https://mint.zero'] }),
    'routstr-store': blob({ balance: 21 }),
    'mint-store:profile:1': blob({ mints: ['https://mint.one'] }),
  };
}

/** Storage as a current release leaves it: everything under pubkey keys. */
function currentInstall(): StorageMap {
  return {
    'profile-store': blob(
      {
        activeAccountIndex: 1,
        profiles: [
          { accountIndex: 0, pubkey: pubkey0, addedAt: 1 },
          { accountIndex: 1, pubkey: pubkey1, addedAt: 2 },
        ],
      },
      2
    ),
    'settings-store': blob({ hasSeenOnboarding: true }),
    'wallet-lifecycle': blob({
      seedCreatedAt: null,
      restoreStatus: 'pending',
      lastRestoreAt: null,
    }),
    [`mint-store:profile:${pubkey0}`]: blob({ mints: ['https://mint.zero'] }),
    [`mint-store:profile:${pubkey1}`]: blob({ mints: ['https://mint.one'] }),
    [`theme-store:profile:${pubkey1}`]: blob({ activeAlbumSlug: 'dusk', unitWallpapers: {} }),
    [COMPLETED_KEY]: JSON.stringify(ALL_MIGRATIONS),
  };
}

beforeEach(() => {
  jest.mocked(AsyncStorage.getItem).mockImplementation(async (key) => mockStorage[key] ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    mockStorage[key] = value;
  });
});

it('stops and reports when a copy fails halfway, then finishes on a retry', async () => {
  mockStorage = indexKeyedInstall();
  // The first destination write lands; the second one fails.
  let writes = 0;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    writes += 1;
    if (writes === 2) throw new Error('disk full');
    mockStorage[key] = value;
  });

  await expect(runGlobalMigrations()).rejects.toThrow('disk full');

  // Nothing is marked done and the later migrations did not run.
  expect(mockStorage[COMPLETED_KEY]).toBeUndefined();
  expect(mockStorage['wallet-lifecycle']).toBeUndefined();
  // A source whose copy failed is still where it was.
  expect(mockStorage['routstr-store']).toBe(blob({ balance: 21 }));

  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    mockStorage[key] = value;
  });
  await expect(runGlobalMigrations()).resolves.toBeUndefined();

  expect(JSON.parse(mockStorage[COMPLETED_KEY])).toEqual(ALL_MIGRATIONS);
  expect(mockStorage[`mint-store:profile:${pubkey0}`]).toBe(blob({ mints: ['https://mint.zero'] }));
  expect(mockStorage[`routstr-store:profile:${pubkey0}`]).toBe(blob({ balance: 21 }));
  expect(mockStorage[`mint-store:profile:${pubkey1}`]).toBe(blob({ mints: ['https://mint.one'] }));
  expect(mockStorage['mint-store']).toBeUndefined();
  expect(mockStorage['routstr-store']).toBeUndefined();
});

it('keeps a finished migration marked when a later one fails', async () => {
  mockStorage = { ...currentInstall(), 'settings-store': blob({ theme: 'aurora' }) };
  mockStorage[COMPLETED_KEY] = JSON.stringify(['index-to-pubkey-keys-v2']);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key.startsWith('theme-store')) throw new Error('disk full');
    mockStorage[key] = value;
  });
  mockStorage['profile-store'] = blob({
    activeAccountIndex: 0,
    profiles: [{ accountIndex: 0, pubkey: pubkey0, addedAt: 1 }],
  });

  await expect(runGlobalMigrations()).rejects.toThrow('disk full');

  expect(JSON.parse(mockStorage[COMPLETED_KEY])).toEqual(['index-to-pubkey-keys-v2']);
  // The legacy theme is still in settings for the retry to move.
  expect(JSON.parse(mockStorage['settings-store']).state.theme).toBe('aurora');
});

it('stops without writing when the completion marker cannot be read', async () => {
  mockStorage = currentInstall();
  const before = { ...mockStorage };
  jest.mocked(AsyncStorage.getItem).mockImplementation(async (key) => {
    if (key === COMPLETED_KEY) throw new Error('storage unavailable');
    return mockStorage[key] ?? null;
  });

  await expect(runGlobalMigrations()).rejects.toThrow('storage unavailable');

  expect(mockStorage).toEqual(before);
});

it('replays every migration over a current install without changing account data', async () => {
  // A marker that reads but does not parse cannot be retried into health, so
  // the migrations run again. They must find nothing to do.
  mockStorage = { ...currentInstall(), [COMPLETED_KEY]: '{not json' };
  const before = { ...mockStorage };

  await expect(runGlobalMigrations()).resolves.toBeUndefined();

  expect(JSON.parse(mockStorage[COMPLETED_KEY])).toEqual(ALL_MIGRATIONS);
  const { [COMPLETED_KEY]: _marker, ...after } = mockStorage;
  const { [COMPLETED_KEY]: _oldMarker, ...expected } = before;
  expect(after).toEqual(expected);
});
