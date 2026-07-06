/* eslint-disable import/first */

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

import { migrateThemeStore } from '@/shared/stores/profile/themeStore';

describe('migrateThemeStore v1 → v2 (one-time theme reset)', () => {
  it('discards prior album, unit wallpapers, and mode from a v1 blob', () => {
    const v1 = {
      activeAlbumSlug: 'artemis',
      unitWallpapers: { sat: 'artemis-3', usd: 'artemis-1' },
      mode: 'light',
    };

    expect(migrateThemeStore(v1, 1)).toEqual({
      activeAlbumSlug: null,
      unitWallpapers: {},
      mode: 'dark',
    });
  });

  it('resets legacy v0 blobs seeded by the global theme migration', () => {
    const v0 = {
      activeAlbumSlug: null,
      unitWallpapers: { sat: 'flowers-1' },
      mode: 'dark',
    };

    expect(migrateThemeStore(v0, 0)).toEqual({
      activeAlbumSlug: null,
      unitWallpapers: {},
      mode: 'dark',
    });
  });

  it('returns fresh defaults each call — no shared mutable state', () => {
    const a = migrateThemeStore({}, 1);
    const b = migrateThemeStore({}, 1);
    expect(a).not.toBe(b);
    expect(a.unitWallpapers).not.toBe(b.unitWallpapers);
  });
});
