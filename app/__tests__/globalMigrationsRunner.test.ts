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
  'adopt-leftover-bare-stores-v1',
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
    // A global store today, on the bare key account 0 once used.
    'own-profile-stats-cache': blob({ entries: { [pubkey0]: { followers: 3 } } }),
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

  expect(JSON.parse(mockStorage[COMPLETED_KEY])).toEqual([
    'adopt-leftover-bare-stores-v1',
    'index-to-pubkey-keys-v2',
  ]);
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

it('fails a list entry that is global today unless the migration leaves its bare key alone', () => {
  // Every name the index migration moves must still be per-profile, or be
  // listed as now-global. Otherwise a replay takes a live global store's data.
  const { declaredStores } = jest.requireActual('@/shared/lib/account/accountRegistry');
  const source = jest
    .requireActual('fs')
    .readFileSync(require.resolve('@/shared/lib/migrations/globalMigrations'), 'utf8') as string;
  const list = (start: string) => {
    const from = source.indexOf(start);
    const body = source.slice(from, source.indexOf(']', from));
    return [...body.matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1]);
  };
  const moved = list('const INDEX_TO_PUBKEY_STORE_KEYS = [');
  const exempt = new Set(list('const NOW_GLOBAL_STORE_KEYS'));
  const globalNow = (declaredStores as { name: string; scope: string }[])
    .filter((entry) => entry.scope === 'global')
    .map((entry) => entry.name);

  expect(moved.length).toBeGreaterThan(20);
  expect(moved.filter((name) => globalNow.includes(name) && !exempt.has(name))).toEqual([]);
});

describe('upgrading from a released build', () => {
  // v0.1.0 through v0.1.3 shipped these three migrations and wrote the marker
  // as a sorted JSON array, read from those tags. Every install that has
  // launched one of them once has all three recorded.
  const RELEASED_MARKER = JSON.stringify([
    'index-to-pubkey-keys-v2',
    'legacy-global-theme-to-profile-v1',
    'wallet-lifecycle-stamp-existing-users-v1',
  ]);

  // Added after 0.1.3. On a released install it finds nothing to adopt and is
  // only recorded.
  const ADDED_SINCE = ['adopt-leftover-bare-stores-v1'];
  const CURRENT_MARKER = [...JSON.parse(RELEASED_MARKER), ...ADDED_SINCE].sort();

  it('opens storage without touching anything a released build wrote', async () => {
    mockStorage = { ...currentInstall(), [COMPLETED_KEY]: RELEASED_MARKER };
    const before = { ...mockStorage };
    jest.mocked(AsyncStorage.setItem).mockClear();
    jest.mocked(AsyncStorage.removeItem).mockClear();

    // Resolving is what lets the gate open: no retry screen on upgrade.
    await expect(runGlobalMigrations()).resolves.toBeUndefined();

    // The one write is the marker gaining the migration added since.
    expect(jest.mocked(AsyncStorage.setItem).mock.calls).toEqual([
      [COMPLETED_KEY, JSON.stringify(CURRENT_MARKER)],
    ]);
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    expect(mockStorage).toEqual({ ...before, [COMPLETED_KEY]: JSON.stringify(CURRENT_MARKER) });
  });

  it('still runs every migration the released builds recorded, under the same ids', () => {
    // Renaming an id would replay that migration on every upgraded install.
    expect(ALL_MIGRATIONS.slice().sort()).toEqual(CURRENT_MARKER);
    expect(ALL_MIGRATIONS).toEqual(expect.arrayContaining(JSON.parse(RELEASED_MARKER)));
  });

  it('finishes a released build whose first launch was cut short', async () => {
    // Killed after the first migration was recorded: the rest run now, once.
    mockStorage = {
      ...currentInstall(),
      [COMPLETED_KEY]: JSON.stringify(['index-to-pubkey-keys-v2']),
    };
    const before = { ...mockStorage };

    await expect(runGlobalMigrations()).resolves.toBeUndefined();

    expect(JSON.parse(mockStorage[COMPLETED_KEY])).toEqual(CURRENT_MARKER);
    const { [COMPLETED_KEY]: _marker, ...after } = mockStorage;
    const { [COMPLETED_KEY]: _oldMarker, ...expected } = before;
    expect(after).toEqual(expected);
  });
});
