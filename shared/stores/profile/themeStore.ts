/**
 * Profile-scoped theme store.
 *
 * Owns the active album, per-unit wallpaper assignments, and light/dark mode
 * for the current profile. The wallet screen's units each get their own
 * wallpaper within the active album; any unit can be individually overridden.
 *
 * Album commits land here via `themeDraft.commit()` — the draft owns the
 * unit-to-wallpaper distribution (newest-first from the album catalog).
 *
 * Resolution for `getUnitWallpaper(unitId?)`:
 *   1. explicit `unitWallpapers[unitId]` override
 *   2. first-unit's wallpaper (for chrome surfaces that just want "a wallpaper")
 *   3. newest theme in the active album
 *   4. `'dark'` built-in fallback
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { storeLog } from '@/shared/lib/logger';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { useWallpaperStore } from '@/shared/stores/global/wallpaperStore';
import {
  BUILTIN_COLORS_ALBUM_SLUG,
  BUILTIN_COLOR_THEME_NAMES,
} from '@/shared/lib/theme/builtinAlbums';
import { PersistedThemeStore, type ThemeMode } from '@sovranbitcoin/schemas';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

const profileStorage = createProfileScopedStorage();

export type UnitId = string;
export type ThemeName = string;
export type { ThemeMode };

const FALLBACK_THEME: ThemeName = 'dark';
const DEFAULT_MODE: ThemeMode = 'dark';

interface ThemeState {
  _hasHydrated: boolean;
  activeAlbumSlug: string | null;
  unitWallpapers: Record<UnitId, ThemeName>;
  mode: ThemeMode;
}

interface ThemeActions {
  /** Set a single unit's wallpaper override (any theme from any album). */
  setUnitWallpaper: (unitId: UnitId, theme: ThemeName) => void;
  /** Resolve a unit's wallpaper, walking the fallback chain. */
  getUnitWallpaper: (unitId?: UnitId) => ThemeName;
}

type ThemeStore = ThemeState & ThemeActions;

function getCatalogThemesForAlbum(albumSlug: string): ThemeName[] {
  if (albumSlug === BUILTIN_COLORS_ALBUM_SLUG) {
    return [...BUILTIN_COLOR_THEME_NAMES];
  }
  const catalog = useWallpaperStore.getState().catalog;
  return catalog
    .filter((w) => w.albumSlug === albumSlug)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((w) => w.themeName);
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      _hasHydrated: false,
      activeAlbumSlug: null,
      unitWallpapers: {},
      mode: DEFAULT_MODE,

      setUnitWallpaper: (unitId, theme) => {
        storeLog.info('store.theme.set_unit_wallpaper', { unitId, theme });
        set((state) => ({
          unitWallpapers: { ...state.unitWallpapers, [unitId]: theme },
        }));
      },

      getUnitWallpaper: (unitId) => {
        const { unitWallpapers, activeAlbumSlug } = get();
        if (unitId && unitWallpapers[unitId]) return unitWallpapers[unitId];
        const firstOverride = Object.values(unitWallpapers)[0];
        if (firstOverride) return firstOverride;
        if (activeAlbumSlug) {
          const pool = getCatalogThemesForAlbum(activeAlbumSlug);
          if (pool.length > 0) return pool[0];
        }
        return FALLBACK_THEME;
      },
    }),
    persistConfig({
      name: 'theme-store',
      storage: profileStorage,
      schema: PersistedThemeStore,
      partialize: (state) => ({
        activeAlbumSlug: state.activeAlbumSlug,
        unitWallpapers: state.unitWallpapers,
        mode: state.mode,
      }),
      afterHydrate: () => useThemeStore.setState({ _hasHydrated: true }),
    })
  )
);
