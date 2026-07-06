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
 * The wallpaper resolver lives in `shared/lib/theme/resolveUnitWallpaper.ts`
 * so this store can stay independent of the wallpaper catalog (no
 * cross-store import; no cycle).
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { storeLog } from '@/shared/lib/logger';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { PersistedThemeStore, type ThemeMode } from '@sovranbitcoin/schemas';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

const profileStorage = createProfileScopedStorage();

export type UnitId = string;
export type { ThemeMode };

const DEFAULT_MODE: ThemeMode = 'dark';

type PersistedTheme = {
  activeAlbumSlug: string | null;
  unitWallpapers: Record<UnitId, string>;
  mode: ThemeMode;
};

// Append-only migration chain (see mintStore). Zustand only calls migrate on
// a version mismatch, so an "already current" branch would be unreachable.
//
// v1 -> v2: one-time theme reset. Product decision (2026-07): every unit
// defaults to 'dark' unless explicitly assigned, and existing devices start
// from that clean slate — discard prior album / per-unit wallpaper / mode
// choices rather than carrying them forward. Runs per profile blob (the
// storage seam partitions by profile pubkey).
export function migrateThemeStore(state: unknown, version: number): PersistedTheme {
  if (version < 2) {
    return { activeAlbumSlug: null, unitWallpapers: {}, mode: DEFAULT_MODE };
  }
  return state as PersistedTheme;
}

interface ThemeState {
  _hasHydrated: boolean;
  activeAlbumSlug: string | null;
  unitWallpapers: Record<UnitId, string>;
  mode: ThemeMode;
}

interface ThemeActions {
  /** Set a single unit's wallpaper override (any theme from any album). */
  setUnitWallpaper: (unitId: UnitId, theme: string) => void;
}

type ThemeStore = ThemeState & ThemeActions;

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
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
    }),
    persistConfig({
      name: 'theme-store',
      storage: profileStorage,
      schema: PersistedThemeStore,
      version: 2,
      migrate: migrateThemeStore,
      partialize: (state) => ({
        activeAlbumSlug: state.activeAlbumSlug,
        unitWallpapers: state.unitWallpapers,
        mode: state.mode,
      }),
      afterHydrate: () => useThemeStore.setState({ _hasHydrated: true }),
    })
  )
);
