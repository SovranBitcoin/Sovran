/**
 * ProfileWallpaperProvider
 *
 * Bridges the profile-scoped `themeStore` into the rendering tree. Mounted
 * inside AccountScopedProviders (below MigrationGate) so profile-scoped
 * storage is already unblocked by the time this provider runs.
 *
 * Exposes `useUnitWallpaper(unitId?)` — a thin wrapper over the resolver that
 * components prefer over direct store subscription so we control re-render
 * scope. The one-shot legacy-theme migration that used to live here has been
 * moved to `globalMigrations.ts` (runs before any store hydrates).
 */

import React, { createContext, useMemo } from 'react';
import { useThemeStore } from '@/shared/stores/profile/themeStore';
import type { UnitId, ThemeName } from '@/shared/stores/profile/themeStore';
import { initLog, useInitMount } from '@/shared/lib/logger';

initLog('Module', 'ProfileWallpaperProvider loaded');

interface ProfileWallpaperContextValue {
  /** Resolve a wallpaper for a specific unit, or the profile primary if no unitId. */
  getUnitWallpaper: (unitId?: UnitId) => ThemeName;
}

const ProfileWallpaperContext = createContext<ProfileWallpaperContextValue | null>(null);

export function ProfileWallpaperProvider({ children }: { children: React.ReactNode }) {
  useInitMount('ProfileWallpaperProvider');
  const getUnitWallpaper = useThemeStore((s) => s.getUnitWallpaper);

  const value = useMemo<ProfileWallpaperContextValue>(
    () => ({ getUnitWallpaper }),
    [getUnitWallpaper],
  );

  // No hydration gate: this provider sits inside AccountScopedProviders,
  // below MigrationGate, so _migrationGate is already resolved by the time
  // we mount and themeStore hydrates lazily. The resolver tolerates the
  // pre-hydration window by falling back to 'dark'.
  return (
    <ProfileWallpaperContext.Provider value={value}>
      {children}
    </ProfileWallpaperContext.Provider>
  );
}

/**
 * Read the wallpaper for a specific unit, or the profile primary if no unit.
 *
 * Subscribes to the underlying store slices so the hook re-runs when
 * overrides or the active album changes. Use this hook everywhere a
 * component needs "the wallpaper for this surface" — prefer it over a raw
 * `useThemeStore((s) => s.getUnitWallpaper(...))` call, which wouldn't
 * re-run on action mutations.
 */
export function useUnitWallpaper(unitId?: UnitId): ThemeName {
  const unitWallpapers = useThemeStore((s) => s.unitWallpapers);
  const activeAlbumSlug = useThemeStore((s) => s.activeAlbumSlug);
  // Referenced so React's exhaustive-deps keeps us tethered to the slices
  // we actually depend on; the resolver reads from getState() directly.
  void unitWallpapers;
  void activeAlbumSlug;
  return useThemeStore.getState().getUnitWallpaper(unitId);
}
