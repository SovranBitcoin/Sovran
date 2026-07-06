/**
 * Wallpaper resolver — pure functions.
 *
 * Resolves a `themeName` for a given unit by walking the fallback chain
 * (explicit override → newest in active album → 'dark'). A unit with no
 * explicit assignment never inherits a sibling's wallpaper — the default
 * for every unit is 'dark'. Lives outside both stores so neither has to
 * import the other —
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

/** The default theme every unit resolves to when nothing is assigned — also
 *  what applying the built-in solid-colour album assigns to every unit. */
export const FALLBACK_THEME = 'dark';

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
  if (activeAlbumSlug) {
    const pool = getCatalogThemesForAlbum(catalog, activeAlbumSlug);
    if (pool.length > 0) return pool[0];
  }
  return FALLBACK_THEME;
}
