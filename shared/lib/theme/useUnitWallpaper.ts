/**
 * `useUnitWallpaper` — Zustand-subscribed wrapper around `resolveUnitWallpaper`.
 *
 * Subscribes to themeStore (`unitWallpapers`, `activeAlbumSlug`) and
 * wallpaperStore (`catalog`). Re-renders when any of those references change.
 */
import { useShallow } from 'zustand/react/shallow';
import { useThemeStore } from '@/shared/stores/profile/themeStore';
import { useWallpaperStore } from '@/shared/stores/global/wallpaperStore';
import { resolveUnitWallpaper } from '@/shared/lib/theme/resolveUnitWallpaper';

export function useUnitWallpaper(unitId?: string): string {
  const themeState = useThemeStore(
    useShallow((s) => ({
      unitWallpapers: s.unitWallpapers,
      activeAlbumSlug: s.activeAlbumSlug,
    }))
  );
  const catalog = useWallpaperStore((s) => s.catalog);
  return resolveUnitWallpaper(unitId, themeState, catalog);
}
