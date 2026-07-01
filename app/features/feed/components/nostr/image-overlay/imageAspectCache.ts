/**
 * Process-lifetime cache of image aspect ratios learned from `onLoad`.
 *
 * A fresh `ImageBlock` (e.g. opening a thread from the feed, where the same
 * image already rendered) seeds its initial aspect ratio from here so it lays
 * out at the correct size on the first frame — instead of reserving the default
 * 16:9 box and visibly resizing once the (disk-cached) image's `onLoad` fires.
 *
 * Keyed by image URL, so it's shared across every ImageBlock instance for that
 * URL regardless of which screen rendered it. Bounded with FIFO eviction so a
 * long session can't grow it without limit.
 */

const MAX_ENTRIES = 1000;
const cache = new Map<string, number>();

/** The aspect ratio (width / height) learned for this URL, if any. */
export function getCachedAspect(url: string): number | undefined {
  return cache.get(url);
}

/** Record the intrinsic aspect ratio for a URL once its image has loaded. */
export function rememberAspect(url: string, aspect: number): void {
  if (!Number.isFinite(aspect) || aspect <= 0) return;
  if (cache.get(url) === aspect) return;
  // Re-insert at the end so the most-recently-seen URLs survive eviction.
  cache.delete(url);
  cache.set(url, aspect);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}
