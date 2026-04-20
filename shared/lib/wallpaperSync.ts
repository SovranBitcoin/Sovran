// ---------------------------------------------------------------------------
// Wallpaper Sync — catalog refresh and album sync operations
//
// Fetches the wallpaper catalog from the API (falls back to direct relay query)
// and provides sync/download/delete operations for albums.
// ---------------------------------------------------------------------------

import { log } from '@/shared/lib/logger';
import { useWallpaperStore, type WallpaperCatalogEntry, type DownloadedWallpaper } from '@/shared/stores/global/wallpaperStore';
import { fetchWallpaperCatalog } from '@/shared/lib/apiClient';

// ---------------------------------------------------------------------------
// Sync plan
// ---------------------------------------------------------------------------

export interface SyncPlan {
  toAdd: WallpaperCatalogEntry[];
  toUpdate: WallpaperCatalogEntry[];
  toDelete: string[]; // themeNames
  unchanged: string[];
}

/**
 * Compute a sync plan by comparing server catalog with local downloads.
 * Optionally filter by albumSlug.
 */
export function computeSyncPlan(
  serverCatalog: WallpaperCatalogEntry[],
  localDownloaded: Record<string, DownloadedWallpaper>,
  albumSlug?: string,
): SyncPlan {
  const serverWallpapers = albumSlug
    ? serverCatalog.filter((w) => w.albumSlug === albumSlug)
    : serverCatalog;

  const localWallpapers = albumSlug
    ? Object.values(localDownloaded).filter((w) => w.albumSlug === albumSlug)
    : Object.values(localDownloaded);

  const serverMap = new Map(serverWallpapers.map((w) => [w.themeName, w]));
  const localMap = new Map(localWallpapers.map((w) => [w.themeName, w]));

  const toAdd: WallpaperCatalogEntry[] = [];
  const toUpdate: WallpaperCatalogEntry[] = [];
  const unchanged: string[] = [];
  const toDelete: string[] = [];

  // Check server wallpapers against local
  for (const [themeName, serverEntry] of serverMap) {
    const localEntry = localMap.get(themeName);
    if (!localEntry) {
      toAdd.push(serverEntry);
    } else if (localEntry.eventId !== serverEntry.eventId) {
      toUpdate.push(serverEntry);
    } else {
      unchanged.push(themeName);
    }
  }

  // Check local wallpapers not on server (deleted upstream)
  for (const [themeName] of localMap) {
    if (!serverMap.has(themeName)) {
      toDelete.push(themeName);
    }
  }

  return { toAdd, toUpdate, toDelete, unchanged };
}

// ---------------------------------------------------------------------------
// Catalog refresh
// ---------------------------------------------------------------------------

/**
 * Refresh the wallpaper catalog from the API.
 */
export async function refreshCatalog(): Promise<boolean> {
  const result = await fetchWallpaperCatalog();

  if (result.isErr()) {
    log.warn('wallpaper.sync.catalog_failed', { error: result.error.message });
    return false;
  }

  const { wallpapers, albums } = result.value;
  // Schema palette is typed as Record<string, string>; the app's WallpaperCatalogEntry
  // narrows it to the specific shade-keyed ThemePalette. JSON shape matches.
  useWallpaperStore
    .getState()
    .setCatalog(wallpapers as WallpaperCatalogEntry[], albums);
  return true;
}

// ---------------------------------------------------------------------------
// Album operations
// ---------------------------------------------------------------------------

/**
 * Sync an album: download new/updated wallpapers, delete removed ones.
 * Returns the sync plan that was executed.
 */
export async function syncAlbum(
  albumSlug: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<SyncPlan> {
  // Refresh catalog first
  await refreshCatalog();

  const store = useWallpaperStore.getState();
  const plan = computeSyncPlan(store.catalog, store.downloaded, albumSlug);

  const totalOps = plan.toAdd.length + plan.toUpdate.length + plan.toDelete.length;
  let completed = 0;

  // Process deletions first
  for (const themeName of plan.toDelete) {
    await store.removeDownloaded(themeName);
    completed++;
    onProgress?.(completed, totalOps);
  }

  // Download new wallpapers (max 3 concurrent)
  const toDownload = [...plan.toAdd, ...plan.toUpdate];
  const concurrency = 3;

  for (let i = 0; i < toDownload.length; i += concurrency) {
    const batch = toDownload.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (entry) => {
        await store.downloadWallpaper(entry);
        completed++;
        onProgress?.(completed, totalOps);
      }),
    );
  }

  log.info('wallpaper.sync.complete', {
    album: albumSlug,
    added: plan.toAdd.length,
    updated: plan.toUpdate.length,
    deleted: plan.toDelete.length,
    unchanged: plan.unchanged.length,
  });

  return plan;
}

/**
 * Download all wallpapers in an album that aren't already downloaded.
 * Purely additive — does NOT delete anything.
 */
export async function downloadAlbum(
  albumSlug: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<number> {
  // Refresh catalog first
  await refreshCatalog();

  const store = useWallpaperStore.getState();
  const albumWallpapers = store.catalog.filter((w) => w.albumSlug === albumSlug);
  const toDownload = albumWallpapers.filter(
    (w) => !store.downloaded[w.themeName],
  );

  let completed = 0;
  const concurrency = 3;

  for (let i = 0; i < toDownload.length; i += concurrency) {
    const batch = toDownload.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (entry) => {
        await store.downloadWallpaper(entry);
        completed++;
        onProgress?.(completed, toDownload.length);
      }),
    );
  }

  return completed;
}

/**
 * Delete all downloaded wallpapers in an album.
 */
export async function deleteAlbum(albumSlug: string): Promise<number> {
  const store = useWallpaperStore.getState();
  const toDelete = Object.values(store.downloaded).filter(
    (w) => w.albumSlug === albumSlug,
  );

  for (const w of toDelete) {
    await store.removeDownloaded(w.themeName);
  }

  return toDelete.length;
}
