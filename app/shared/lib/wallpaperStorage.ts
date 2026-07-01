// ---------------------------------------------------------------------------
// Wallpaper Storage — local file management for downloaded wallpaper images
//
// Images are stored in documentDirectory/wallpapers/ which survives
// iOS cache purges (unlike cacheDirectory).
// ---------------------------------------------------------------------------

import * as FileSystem from 'expo-file-system/legacy';
import { log } from '@/shared/lib/logger';

const WALLPAPER_DIR = `${FileSystem.documentDirectory}wallpapers/`;

/**
 * Ensure the wallpapers directory exists.
 */
async function ensureWallpaperDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(WALLPAPER_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(WALLPAPER_DIR, { intermediates: true });
  }
}

/**
 * Download a wallpaper image from a URL and save it locally.
 * Returns the local file:// URI.
 */
export async function downloadWallpaper(
  url: string,
  themeName: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  if (!url) {
    throw new Error(`No download URL for wallpaper "${themeName}"`);
  }

  await ensureWallpaperDir();

  const localUri = getWallpaperUri(themeName);

  log.info('wallpaper.download.start', { themeName, url, localUri });

  try {
    let resolveOnProgress: (() => void) | null = null;
    const progressDone = new Promise<void>((r) => {
      resolveOnProgress = r;
    });

    const downloadResumable = FileSystem.createDownloadResumable(
      url,
      localUri,
      {},
      (downloadProgress) => {
        const progress =
          downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
        onProgress?.(progress);
        if (progress >= 1) resolveOnProgress?.();
      }
    );

    const downloadPromise = downloadResumable.downloadAsync();

    // Resolve as soon as either the promise completes or progress reaches 100%.
    // expo-file-system can stall between the last progress callback and promise
    // resolution while it closes the file handle.
    await Promise.race([downloadPromise, progressDone]);

    log.info('wallpaper.download.complete', { themeName, uri: localUri });
    return localUri;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error ?? 'Unknown download error');
    log.error('wallpaper.download.error', { themeName, url, localUri, error: message });
    throw new Error(`Download failed for "${themeName}": ${message}`);
  }
}

/**
 * Check if a wallpaper image exists on disk.
 */
export async function isWallpaperDownloaded(themeName: string): Promise<boolean> {
  const uri = getWallpaperUri(themeName);
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists;
}

/**
 * Get the expected local URI for a wallpaper.
 */
export function getWallpaperUri(themeName: string): string {
  return `${WALLPAPER_DIR}${themeName}.png`;
}

/**
 * Delete a downloaded wallpaper image from disk.
 */
export async function deleteWallpaper(themeName: string): Promise<void> {
  const uri = getWallpaperUri(themeName);
  const info = await FileSystem.getInfoAsync(uri);
  if (info.exists) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    log.info('wallpaper.delete', { themeName });
  }
}

/**
 * Clean up orphaned files — files on disk that aren't tracked in the store.
 * Returns list of cleaned-up file names.
 */
export async function cleanupOrphanedFiles(trackedThemeNames: Set<string>): Promise<string[]> {
  await ensureWallpaperDir();
  const files = await FileSystem.readDirectoryAsync(WALLPAPER_DIR);
  const cleaned: string[] = [];

  for (const file of files) {
    const themeName = file.replace(/\.[^.]+$/, '');
    if (!trackedThemeNames.has(themeName)) {
      await FileSystem.deleteAsync(`${WALLPAPER_DIR}${file}`, { idempotent: true });
      cleaned.push(file);
    }
  }

  if (cleaned.length > 0) {
    log.info('wallpaper.cleanup', { count: cleaned.length, files: cleaned });
  }

  return cleaned;
}
