/**
 * Migration: legacy `settingsStore.theme` (string, global) →
 *   active-profile `theme-store:profile:{pubkey}` (per-profile, per-unit).
 *
 * The real migration lives in shared/lib/migrations/globalMigrations.ts and
 * runs once at app startup against AsyncStorage. Here we reproduce the
 * algorithm as a pure function so we can drive it with plain objects and
 * assert its three branches (album wallpaper, built-in colour theme, unknown
 * string) without a storage mock.
 */

import { isBuiltinColorTheme, PROFILE_PRIMARY_UNIT_ID } from '@/shared/lib/theme/builtinAlbums';

type StorageMap = Record<string, string>;

async function runMigration(store: StorageMap): Promise<void> {
  const settingsRaw = store['settings-store'];
  if (!settingsRaw) return;

  const settingsParsed = JSON.parse(settingsRaw);
  const legacyTheme = settingsParsed?.state?.theme;

  if (typeof legacyTheme !== 'string' || !legacyTheme) {
    if (settingsParsed?.state && 'theme' in settingsParsed.state) {
      delete settingsParsed.state.theme;
      store['settings-store'] = JSON.stringify(settingsParsed);
    }
    return;
  }

  const profileRaw = store['profile-store'];
  if (profileRaw) {
    const profileParsed = JSON.parse(profileRaw);
    const profiles: { accountIndex: number; pubkey: string }[] =
      profileParsed?.state?.profiles ?? [];
    const activeIndex: number | undefined = profileParsed?.state?.activeAccountIndex;
    const activeProfile =
      profiles.find((p) => p.accountIndex === activeIndex) ?? profiles[0];

    if (activeProfile?.pubkey && !isBuiltinColorTheme(legacyTheme)) {
      const themeStoreKey = `theme-store:profile:${activeProfile.pubkey}`;
      const existingRaw = store[themeStoreKey];
      const existing = existingRaw ? JSON.parse(existingRaw) : null;
      const hasUserData =
        !!existing?.state?.activeAlbumSlug ||
        (existing?.state?.unitWallpapers &&
          Object.keys(existing.state.unitWallpapers).length > 0);

      if (!hasUserData) {
        const nextBlob = {
          state: {
            activeAlbumSlug: null,
            unitWallpapers: { [PROFILE_PRIMARY_UNIT_ID]: legacyTheme },
            mode: 'dark',
          },
          version: 0,
        };
        store[themeStoreKey] = JSON.stringify(nextBlob);
      }
    }
  }

  if (settingsParsed?.state) {
    delete settingsParsed.state.theme;
    store['settings-store'] = JSON.stringify(settingsParsed);
  }
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
    expect(Object.keys(store)).toEqual([]);
  });
});
