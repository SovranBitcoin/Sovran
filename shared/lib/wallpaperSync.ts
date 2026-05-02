import { log } from '@/shared/lib/logger';
import {
  useWallpaperStore,
  type WallpaperCatalogEntry,
} from '@/shared/stores/global/wallpaperStore';
import { fetchWallpaperCatalog } from '@/shared/lib/apiClient';

/**
 * Refresh the wallpaper catalog from the API. `signal` aborts the fetch
 * if the caller goes away before the catalog lands.
 */
export async function refreshCatalog(signal?: AbortSignal): Promise<boolean> {
  const result = await fetchWallpaperCatalog({ signal });

  if (result.isErr()) {
    log.warn('wallpaper.sync.catalog_failed', { error: result.error.message });
    return false;
  }

  const { wallpapers, albums } = result.value;
  // Schema palette is typed as Record<string, string>; the app's WallpaperCatalogEntry
  // narrows it to the specific shade-keyed ThemePalette. JSON shape matches.
  useWallpaperStore.getState().setCatalog(wallpapers as WallpaperCatalogEntry[], albums);
  return true;
}
