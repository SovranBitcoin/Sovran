// ---------------------------------------------------------------------------
// Wallpaper Storage — local file management for downloaded wallpaper images
//
// Images are stored in documentDirectory/wallpapers/ which survives
// iOS cache purges (unlike cacheDirectory).
// ---------------------------------------------------------------------------

import * as FileSystem from 'expo-file-system/legacy';
import { log } from '@/shared/lib/logger';

const WALLPAPER_DIR = `${FileSystem.documentDirectory}wallpapers/`;

// A real wallpaper JPEG/PNG is hundreds of KB; anything smaller is an empty or
// truncated download (e.g. an unwritten file or a redirect stub) that would
// fail to decode and render the background black. Reject it so the theme falls
// back to its gradient instead.
const MIN_WALLPAPER_BYTES = 1024;

// Hard ceiling so a stalled native download handle can't hang the whole
// theme-commit chain. A 1080x1920 wallpaper is ~1MB and fetches in a couple of
// seconds; 60s is generous headroom.
const DOWNLOAD_TIMEOUT_MS = 60_000;

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
    const downloadResumable = FileSystem.createDownloadResumable(
      url,
      localUri,
      {},
      (downloadProgress) => {
        const total = downloadProgress.totalBytesExpectedToWrite;
        // total is 0/-1 before the (possibly redirected) response's
        // Content-Length is known — guard the divide so we never report a
        // bogus 100% mid-flight.
        const progress = total > 0 ? downloadProgress.totalBytesWritten / total : 0;
        onProgress?.(progress);
      }
    );

    // Await the ACTUAL download completion — never a progress-callback race.
    // The old race resolved on the first progress tick that read >=100% (which
    // a redirect's zero-length Content-Length made fire early), returning a
    // file:// URI while the bytes were still being written. The background
    // then registered that theme and `<Image>` decoded a truncated/empty file
    // ("Downloaded image decode failed") and rendered black.
    const result = await withTimeout(
      downloadResumable.downloadAsync(),
      DOWNLOAD_TIMEOUT_MS,
      themeName
    );

    const status = result?.status ?? 0;
    if (status < 200 || status >= 300) {
      throw new Error(`HTTP ${status || 'no-response'}`);
    }

    // Only report success once the file is actually a plausible image on disk.
    // An empty/truncated download registered as a wallpaper is worse than no
    // wallpaper: it decode-fails silently and paints the screen black.
    const info = await FileSystem.getInfoAsync(localUri);
    const bytes = info.exists ? (info.size ?? 0) : 0;
    if (bytes < MIN_WALLPAPER_BYTES) {
      throw new Error(`empty download (${info.exists ? `${bytes} bytes` : 'missing'})`);
    }

    log.info('wallpaper.download.complete', { themeName, uri: localUri, status, bytes });
    return localUri;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error ?? 'Unknown download error');
    log.error('wallpaper.download.error', { themeName, url, localUri, error: message });
    // Remove any partial/empty file so a broken download can't shadow a later
    // retry (isWallpaperDownloaded checks existence, not validity).
    await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
    throw new Error(`Download failed for "${themeName}": ${message}`);
  }
}

/** Reject a download that never resolves so a stalled native handle can't wedge
 *  the theme-commit chain. */
async function withTimeout<T>(promise: Promise<T>, ms: number, themeName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
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
