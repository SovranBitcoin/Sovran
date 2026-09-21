import AsyncStorage from '@react-native-async-storage/async-storage';
import { runGlobalMigrations } from '@/shared/lib/migrations/globalMigrations';

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
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  PROFILE_SCOPED_STORE_KEYS: ['theme-store'],
}));
jest.mock('@/shared/lib/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const COMPLETED_KEY = 'global-migrations-completed';
async function runMigration(store: StorageMap): Promise<void> {
  mockStorage = store;
  store[COMPLETED_KEY] ??= JSON.stringify([
    'index-to-pubkey-keys-v2',
    'wallet-lifecycle-stamp-existing-users-v1',
  ]);
  await runGlobalMigrations();
}

const activePubkey = 'f'.repeat(64);
const profileStoreBlob = JSON.stringify({
  state: {
    profiles: [{ accountIndex: 0, pubkey: activePubkey }],
    activeAccountIndex: 0,
  },
  version: 0,
});

describe('legacy theme migration', () => {
  it('seeds a wallpaper theme name into the active profile theme-store', async () => {
    const store: StorageMap = {
      'settings-store': JSON.stringify({
        state: { theme: 'flowers-1', language: 'en' },
        version: 0,
      }),
      'profile-store': profileStoreBlob,
    };

    await runMigration(store);

    const themeBlob = JSON.parse(store[`theme-store:profile:${activePubkey}`]);
    expect(themeBlob.state.unitWallpapers).toEqual({ sat: 'flowers-1' });
    expect(themeBlob.state.activeAlbumSlug).toBeNull();
    expect(themeBlob.state.mode).toBe('dark');

    const settings = JSON.parse(store['settings-store']);
    expect('theme' in settings.state).toBe(false);
    expect(settings.state.language).toBe('en');
  });

  it('drops built-in colour themes without seeding the profile', async () => {
    const store: StorageMap = {
      'settings-store': JSON.stringify({ state: { theme: 'navy' }, version: 0 }),
      'profile-store': profileStoreBlob,
    };

    await runMigration(store);

    expect(store[`theme-store:profile:${activePubkey}`]).toBeUndefined();
    const settings = JSON.parse(store['settings-store']);
    expect('theme' in settings.state).toBe(false);
  });

  it('leaves an already-seeded profile theme-store untouched', async () => {
    const existing = {
      state: {
        activeAlbumSlug: 'artemis',
        unitWallpapers: { sat: 'artemis-3' },
        mode: 'light',
      },
      version: 0,
    };
    const store: StorageMap = {
      'settings-store': JSON.stringify({ state: { theme: 'flowers-1' }, version: 0 }),
      'profile-store': profileStoreBlob,
      [`theme-store:profile:${activePubkey}`]: JSON.stringify(existing),
    };

    await runMigration(store);

    const themeBlob = JSON.parse(store[`theme-store:profile:${activePubkey}`]);
    expect(themeBlob.state.activeAlbumSlug).toBe('artemis');
    expect(themeBlob.state.unitWallpapers).toEqual({ sat: 'artemis-3' });
  });

  it('is idempotent — re-running with cleaned settings does nothing', async () => {
    const store: StorageMap = {
      'settings-store': JSON.stringify({ state: { language: 'en' }, version: 0 }),
      'profile-store': profileStoreBlob,
    };

    await runMigration(store);
    await runMigration(store);

    expect(store[`theme-store:profile:${activePubkey}`]).toBeUndefined();
  });

  it('exits cleanly when no legacy settings blob exists (fresh install)', async () => {
    const store: StorageMap = {};
    await runMigration(store);
    expect(store['settings-store']).toBeUndefined();
    expect(store[`theme-store:profile:${activePubkey}`]).toBeUndefined();
  });
  it('keeps the source and retries when persisting the migrated theme fails', async () => {
    const store: StorageMap = {
      'settings-store': JSON.stringify({ state: { theme: 'flowers-1' }, version: 0 }),
      'profile-store': profileStoreBlob,
    };
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
    await runMigration(store);
    expect(JSON.parse(store['settings-store']).state.theme).toBe('flowers-1');
    expect(JSON.parse(store[COMPLETED_KEY])).not.toContain('legacy-global-theme-to-profile-v1');
    await runMigration(store);
    expect(JSON.parse(store[`theme-store:profile:${activePubkey}`]).state.unitWallpapers).toEqual({
      sat: 'flowers-1',
    });
  });

  it('does not overwrite an existing pubkey-scoped store with an older index-scoped copy', async () => {
    const current = JSON.stringify({ state: { activeAlbumSlug: 'current' }, version: 1 });
    mockStorage = {
      'profile-store': profileStoreBlob,
      'theme-store': JSON.stringify({ state: { activeAlbumSlug: 'old' }, version: 1 }),
      [`theme-store:profile:${activePubkey}`]: current,
    };
    await runGlobalMigrations();
    expect(mockStorage[`theme-store:profile:${activePubkey}`]).toBe(current);
  });

  it('skips a profile row without a usable pubkey and keeps its index-scoped stores', async () => {
    const first = JSON.stringify({ state: { activeAlbumSlug: 'first' }, version: 1 });
    const second = JSON.stringify({ state: { activeAlbumSlug: 'second' }, version: 1 });
    const third = JSON.stringify({ state: { activeAlbumSlug: 'third' }, version: 1 });
    mockStorage = {
      'profile-store': JSON.stringify({
        state: {
          profiles: [
            { accountIndex: 0, pubkey: activePubkey },
            { accountIndex: 1 },
            { accountIndex: 2, pubkey: 42 },
          ],
        },
        version: 0,
      }),
      'theme-store': first,
      'theme-store:profile:1': second,
      'theme-store:profile:2': third,
    };

    await runGlobalMigrations();

    expect(mockStorage[`theme-store:profile:${activePubkey}`]).toBe(first);
    expect(mockStorage['theme-store']).toBeUndefined();
    expect(mockStorage['theme-store:profile:1']).toBe(second);
    expect(mockStorage['theme-store:profile:2']).toBe(third);
    expect(mockStorage['theme-store:profile:undefined']).toBeUndefined();
    expect(mockStorage['theme-store:profile:42']).toBeUndefined();
    expect(JSON.parse(mockStorage[COMPLETED_KEY])).toContain('index-to-pubkey-keys-v2');
  });

  it('leaves every store untouched when profile-store is corrupt JSON', async () => {
    const before: StorageMap = {
      'profile-store': '{"state":{"profiles":[',
      'settings-store': JSON.stringify({ state: { theme: 'flowers-1' }, version: 0 }),
      'theme-store': JSON.stringify({ state: { activeAlbumSlug: 'old' }, version: 1 }),
      'theme-store:profile:1': JSON.stringify({ state: { activeAlbumSlug: 'other' }, version: 1 }),
    };
    mockStorage = { ...before };

    await runGlobalMigrations();

    const { [COMPLETED_KEY]: _completed, 'wallet-lifecycle': _lifecycle, ...rest } = mockStorage;
    expect(rest).toEqual(before);
  });

  it('does not seed the legacy theme into another profile when the active row is unusable', async () => {
    const store: StorageMap = {
      'settings-store': JSON.stringify({ state: { theme: 'flowers-1' }, version: 0 }),
      'profile-store': JSON.stringify({
        state: {
          profiles: [{ accountIndex: 0, pubkey: activePubkey }, { accountIndex: 1 }],
          activeAccountIndex: 1,
        },
        version: 0,
      }),
    };

    await runMigration(store);

    expect(store[`theme-store:profile:${activePubkey}`]).toBeUndefined();
    expect(store['theme-store:profile:undefined']).toBeUndefined();
  });
});
