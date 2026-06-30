/**
 * Wallpaper resolver — pure functions.
 *
 * Resolves a `themeName` for a given unit by walking the fallback chain
 * (explicit override → first stored override → newest in active album →
 * 'dark'). Lives outside both stores so neither has to import the other —
 * this is the seam that breaks the themeStore ↔ wallpaperStore cycle.
 *
 * Pure-only on purpose so tests can drive it with plain objects without
 * pulling in the persist middleware. See `useUnitWallpaper.ts` for the
 * Zustand-subscribed hook.
 */
import {
  BUILTIN_COLORS_ALBUM_SLUG,
  BUILTIN_COLOR_THEME_NAMES,
} from '@/shared/lib/theme/builtinAlbums';

const FALLBACK_THEME = 'dark';

interface CatalogEntry {
  themeName: string;
  albumSlug: string;
  createdAt: number;
}

/** Themes available in an album, newest-first. The built-in 'colors' album
 *  returns its synthetic list; everything else filters the wallpaper catalog. */
export function getCatalogThemesForAlbum(
  catalog: readonly CatalogEntry[],
  albumSlug: string
): string[] {
  if (albumSlug === BUILTIN_COLORS_ALBUM_SLUG) {
    return [...BUILTIN_COLOR_THEME_NAMES];
  }
  return catalog
    .filter((w) => w.albumSlug === albumSlug)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((w) => w.themeName);
}

interface ResolverThemeState {
  unitWallpapers: Record<string, string>;
  activeAlbumSlug: string | null;
}

/** Pure resolver — walks the fallback chain. */
export function resolveUnitWallpaper(
  unitId: string | undefined,
  themeState: ResolverThemeState,
  catalog: readonly CatalogEntry[]
): string {
  const { unitWallpapers, activeAlbumSlug } = themeState;
  if (unitId && unitWallpapers[unitId]) return unitWallpapers[unitId];
  const firstOverride = Object.values(unitWallpapers)[0];
  if (firstOverride) return firstOverride;
  if (activeAlbumSlug) {
    const pool = getCatalogThemesForAlbum(catalog, activeAlbumSlug);
    if (pool.length > 0) return pool[0];
  }
  return FALLBACK_THEME;
}
