/**
 * Profile-scoped theme store.
 *
 * Owns the active album, per-unit wallpaper assignments, and light/dark mode
 * for the current profile. The wallet screen's units each get their own
 * wallpaper within the active album; any unit can be individually overridden.
 *
 * Applying an album WIPES all per-unit overrides and eagerly re-randomises
 * from the new album's wallpapers (Revolut pattern). The randomisation is
 * deterministic — seeded by profile pubkey + album slug — so the same
 * profile on two devices agrees on assignments.
 *
 * Resolution for `getUnitWallpaper(unitId?)`:
 *   1. explicit `unitWallpapers[unitId]` override
 *   2. first-unit's wallpaper (for chrome surfaces that just want "a wallpaper")
 *   3. deterministic pick from the active album
 *   4. `'dark'` built-in fallback
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { log, storeLog } from '@/shared/lib/logger';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useWallpaperStore } from '@/shared/stores/global/wallpaperStore';
import {
  BUILTIN_COLORS_ALBUM_SLUG,
  BUILTIN_COLOR_THEME_NAMES,
} from '@/shared/lib/theme/builtinAlbums';
import {
  PersistedThemeStore,
  type ThemeMode,
  loggableIssues,
} from '@sovranbitcoin/schemas';

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
  /** Wipe existing overrides and assign a fresh wallpaper from `albumSlug` to each unit. */
  applyAlbum: (albumSlug: string, unitIds: UnitId[]) => void;
  /** Set a single unit's wallpaper override (any theme from any album). */
  setUnitWallpaper: (unitId: UnitId, theme: ThemeName) => void;
  /** Resolve a unit's wallpaper, walking the fallback chain. */
  getUnitWallpaper: (unitId?: UnitId) => ThemeName;
  /** Returns all currently-assigned unit wallpapers as a list. */
  getAllUnitWallpapers: () => Array<{ unitId: UnitId; theme: ThemeName }>;
  /** Set light/dark mode for this profile. */
  setMode: (mode: ThemeMode) => void;
  /** Remove the active album and all overrides — falls back to FALLBACK_THEME. Mode is preserved. */
  resetToDefault: () => void;
  /** Wipe all persisted data for the current profile. */
  clearAllData: () => Promise<void>;
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

function getActiveProfilePubkey(): string {
  const state = useProfileStore.getState();
  return (
    state.profiles.find((p) => p.accountIndex === state.activeAccountIndex)?.pubkey ?? ''
  );
}

/**
 * Deterministic shuffle seeded by a string. Uses a simple xorshift so the
 * same (seed, input) pair always produces the same order without pulling in
 * a crypto dependency.
 */
function seededShuffle<T>(items: T[], seed: string): T[] {
  if (items.length <= 1) return items.slice();
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const rand = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1_000_000) / 1_000_000;
  };
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Assign wallpapers from `pool` to `unitIds`:
 *  - pool smaller than unitIds → cycle through pool
 *  - pool larger → pick without immediate repeats in the first pool.length slots
 */
function distributeWallpapers(
  pool: ThemeName[],
  unitIds: UnitId[],
  seed: string,
): Record<UnitId, ThemeName> {
  if (pool.length === 0 || unitIds.length === 0) return {};
  const shuffled = seededShuffle(pool, seed);
  const assigned: Record<UnitId, ThemeName> = {};
  for (let i = 0; i < unitIds.length; i++) {
    assigned[unitIds[i]] = shuffled[i % shuffled.length];
  }
  return assigned;
}

function pickFirstThemeForAlbum(albumSlug: string, seed: string): ThemeName | null {
  const pool = getCatalogThemesForAlbum(albumSlug);
  if (pool.length === 0) return null;
  return seededShuffle(pool, seed)[0];
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      _hasHydrated: false,
      activeAlbumSlug: null,
      unitWallpapers: {},
      mode: DEFAULT_MODE,

      applyAlbum: (albumSlug, unitIds) => {
        const pool = getCatalogThemesForAlbum(albumSlug);
        if (pool.length === 0) {
          log.warn('theme.apply_album.empty_pool', { albumSlug });
          return;
        }
        const seed = `${getActiveProfilePubkey()}:${albumSlug}`;
        const unitWallpapers = distributeWallpapers(pool, unitIds, seed);
        storeLog.info('store.theme.apply_album', {
          albumSlug,
          unitCount: unitIds.length,
          poolSize: pool.length,
        });
        set({ activeAlbumSlug: albumSlug, unitWallpapers });
      },

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
          const seed = `${getActiveProfilePubkey()}:${activeAlbumSlug}`;
          const fallback = pickFirstThemeForAlbum(activeAlbumSlug, seed);
          if (fallback) return fallback;
        }
        return FALLBACK_THEME;
      },

      getAllUnitWallpapers: () =>
        Object.entries(get().unitWallpapers).map(([unitId, theme]) => ({ unitId, theme })),

      setMode: (mode) => {
        storeLog.info('store.theme.set_mode', { mode });
        set({ mode });
      },

      resetToDefault: () => {
        storeLog.info('store.theme.reset');
        set({ activeAlbumSlug: null, unitWallpapers: {} });
      },

      clearAllData: async () => {
        try {
          await profileStorage.removeItem('theme-store');
          set({ activeAlbumSlug: null, unitWallpapers: {}, mode: DEFAULT_MODE });
        } catch (error) {
          log.error('store.theme.clear_failed', { error });
          throw error;
        }
      },
    }),
    {
      name: 'theme-store',
      storage: createJSONStorage(() => profileStorage),
      partialize: (state) => ({
        activeAlbumSlug: state.activeAlbumSlug,
        unitWallpapers: state.unitWallpapers,
        mode: state.mode,
      }),
      // Defensive Zod validation on rehydrate. Drop the persisted blob to the
      // initial state if it doesn't pass safeParse — never throws, never
      // swallows unknown fields (looseObject).
      merge: (persisted, current) => {
        if (!persisted || typeof persisted !== 'object') return current;
        const r = PersistedThemeStore.safeParse(persisted);
        if (!r.success) {
          log.warn('store.theme.merge_rejected', {
            issues: loggableIssues({ type: 'schema/zod', where: 'theme-store', issues: r.error.issues }),
          });
          return current;
        }
        return { ...current, ...r.data };
      },
      onRehydrateStorage: () => (_state, error) => {
        if (error) log.warn('store.theme.rehydrate_failed', { error });
        useThemeStore.setState({ _hasHydrated: true });
      },
    },
  ),
);
