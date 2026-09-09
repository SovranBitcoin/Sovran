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
let downloadSequence = 0;
const activeDownloadFiles = new Set<string>();
const publishing = new Map<string, Promise<void>>();

async function removeDownloadFile(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  activeDownloadFiles.delete(uri);
}

/** Serialise only promotion, keeping concurrent downloads independent. iOS's
 * legacy move removes the destination first, so retain a recoverable copy until
 * the replacement is published. Never delete that copy if restoration fails. */
async function publishWallpaper(stagingUri: string, localUri: string): Promise<void> {
  const previous = publishing.get(localUri) ?? Promise.resolve();
  const pending = previous
    .catch(() => {})
    .then(async () => {
      const backupUri = `${stagingUri}.backup`;
      const existing = await FileSystem.getInfoAsync(localUri);
      if (existing.exists) {
        await FileSystem.copyAsync({ from: localUri, to: backupUri });
      }
      try {
        await FileSystem.moveAsync({ from: stagingUri, to: localUri });
      } catch (error) {
        if (existing.exists) {
          // If this also fails, the .backup remains for recovery rather than
          // being included in orphan cleanup or deleted by the outer catch.
          await FileSystem.moveAsync({ from: backupUri, to: localUri });
        }
        throw error;
      }
      if (existing.exists) await removeDownloadFile(backupUri);
    });
  publishing.set(localUri, pending);
  try {
    await pending;
  } finally {
    if (publishing.get(localUri) === pending) publishing.delete(localUri);
  }
}

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
  const stagingUri = `${WALLPAPER_DIR}.download-${Date.now()}-${++downloadSequence}.png`;
  activeDownloadFiles.add(stagingUri);
  let acceptingProgress = true;
  let downloadResumable: FileSystem.DownloadResumable | undefined;
  let download: ReturnType<FileSystem.DownloadResumable['downloadAsync']> | undefined;

  log.info('wallpaper.download.start', { themeName, url, localUri });

  try {
    downloadResumable = FileSystem.createDownloadResumable(
      url,
      stagingUri,
      {},
      (downloadProgress) => {
        if (!acceptingProgress) return;
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
    download = downloadResumable.downloadAsync();
    const result = await withTimeout(download, DOWNLOAD_TIMEOUT_MS);

    const status = result?.status ?? 0;
    if (status < 200 || status >= 300) {
      throw new Error(`HTTP ${status || 'no-response'}`);
    }

    // Only report success once the file is actually a plausible image on disk.
    // An empty/truncated download registered as a wallpaper is worse than no
    // wallpaper: it decode-fails silently and paints the screen black.
    const info = await FileSystem.getInfoAsync(stagingUri);
    const bytes = info.exists ? (info.size ?? 0) : 0;
    if (bytes < MIN_WALLPAPER_BYTES) {
      throw new Error(`empty download (${info.exists ? `${bytes} bytes` : 'missing'})`);
    }

    await publishWallpaper(stagingUri, localUri);
    activeDownloadFiles.delete(stagingUri);
    log.info('wallpaper.download.complete', { themeName, uri: localUri, status, bytes });
    return localUri;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error ?? 'Unknown download error');
    log.error('wallpaper.download.error', { themeName, url, localUri, error: message });
    // A cancellation request does not wait for the native writer to stop.
    // Clean up this attempt only once its download settles; a late completion
    // can never overwrite the canonical image or a retry's unique staging file.
    if (download) {
      void download.then(
        () => removeDownloadFile(stagingUri),
        () => removeDownloadFile(stagingUri)
      );
    } else {
      await removeDownloadFile(stagingUri);
    }
    throw new Error(`Download failed for "${themeName}": ${message}`);
  } finally {
    acceptingProgress = false;
    // Also removes DownloadResumable's JS progress subscription on success.
    // Do not await a potentially stalled native cancellation on the timeout path.
    void downloadResumable?.cancelAsync().catch(() => {
      log.warn('wallpaper.download.cancel_failed', { themeName });
    });
  }
}

/** Reject a download that never resolves so a stalled native handle can't wedge
 *  the theme-commit chain. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
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
    // Live staging files belong to native writers; failed restoration backups
    // must remain available even after a restart.
    if (activeDownloadFiles.has(`${WALLPAPER_DIR}${file}`) || file.endsWith('.backup')) continue;
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
