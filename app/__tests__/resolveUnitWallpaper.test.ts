/**
 * Pure-resolver tests for shared/lib/theme/resolveUnitWallpaper.
 *
 * Drive the fallback chain with plain objects — no Zustand mocks. Covers:
 *   override → newest in active album → 'dark'
 * (a unit never inherits a sibling's wallpaper — the per-unit default is
 * 'dark') plus the built-in 'colors' album short-circuit.
 */

import {
  getCatalogThemesForAlbum,
  resolveUnitWallpaper,
} from '@/shared/lib/theme/resolveUnitWallpaper';

function entry(themeName: string, albumSlug: string, createdAt: number) {
  return { themeName, albumSlug, createdAt };
}

describe('resolveUnitWallpaper', () => {
  it('returns the explicit override for a unit when one is set', () => {
    const result = resolveUnitWallpaper(
      'sat',
      { unitWallpapers: { sat: 'artemis-3' }, activeAlbumSlug: 'flowers' },
      []
    );
    expect(result).toBe('artemis-3');
  });

  it("defaults to 'dark' for a unit with no assignment even when a sibling has one", () => {
    const result = resolveUnitWallpaper(
      'usd',
      { unitWallpapers: { sat: 'artemis-3' }, activeAlbumSlug: null },
      []
    );
    expect(result).toBe('dark');
  });

  it('ignores sibling assignments and uses the active album for an unset unit', () => {
    const catalog = [entry('flowers-old', 'flowers', 1), entry('flowers-new', 'flowers', 100)];
    const result = resolveUnitWallpaper(
      'usd',
      { unitWallpapers: { sat: 'artemis-3' }, activeAlbumSlug: 'flowers' },
      catalog
    );
    expect(result).toBe('flowers-new');
  });

  it('falls back to the newest theme in the active album when no overrides exist', () => {
    const catalog = [
      entry('flowers-old', 'flowers', 1),
      entry('flowers-new', 'flowers', 100),
      entry('other-1', 'other', 50),
    ];
    const result = resolveUnitWallpaper(
      undefined,
      { unitWallpapers: {}, activeAlbumSlug: 'flowers' },
      catalog
    );
    expect(result).toBe('flowers-new');
  });

  it("returns 'dark' when no overrides and no active album", () => {
    const result = resolveUnitWallpaper('sat', { unitWallpapers: {}, activeAlbumSlug: null }, []);
    expect(result).toBe('dark');
  });

  it("returns 'dark' when active album has no catalog entries", () => {
    const result = resolveUnitWallpaper(
      'sat',
      { unitWallpapers: {}, activeAlbumSlug: 'empty-album' },
      [entry('other-1', 'other', 1)]
    );
    expect(result).toBe('dark');
  });

  it("treats unitId=undefined the same as an unset unit — 'dark', no sibling inherit", () => {
    const result = resolveUnitWallpaper(
      undefined,
      { unitWallpapers: { sat: 'artemis-3' }, activeAlbumSlug: null },
      []
    );
    expect(result).toBe('dark');
  });
});

describe('getCatalogThemesForAlbum', () => {
  it("returns the synthetic list for the built-in 'colors' album", () => {
    const result = getCatalogThemesForAlbum([], 'colors');
    expect(result).toContain('dark');
    expect(result).toContain('navy');
  });

  it('filters and sorts catalog entries newest-first', () => {
    const catalog = [
      entry('a', 'flowers', 10),
      entry('b', 'flowers', 30),
      entry('c', 'flowers', 20),
      entry('d', 'other', 100),
    ];
    expect(getCatalogThemesForAlbum(catalog, 'flowers')).toEqual(['b', 'c', 'a']);
  });

  it('returns an empty array for an album with no catalog entries', () => {
    expect(getCatalogThemesForAlbum([], 'flowers')).toEqual([]);
  });
});
