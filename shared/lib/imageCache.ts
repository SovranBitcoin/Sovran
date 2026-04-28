import { Image } from 'expo-image';
import { log } from '@/shared/lib/logger';
import {
  getBootMorphCompleted,
  subscribeBootMorphCompleted,
} from '@/shared/lib/qrButtonAnchor';

const prefetchedUrls = new Set<string>();

function normalizeUrl(url: string): string {
  return url.trim();
}

// Block all image prefetching until the boot splash → QR-button morph has
// settled. Native tabs eagerly mount every tab on boot, and several of them
// (Stories feed, Contacts, payments contacts, etc.) call `prefetchImages`
// immediately on mount. Each prefetch is light on its own, but a few dozen
// firing during the morph window competes with first paint and visibly
// stalls the splash. Once the morph is done the user is on the wallet,
// prefetching can run freely.
let bootGate: Promise<void> | null = null;
function awaitBootGate(): Promise<void> {
  if (getBootMorphCompleted()) return Promise.resolve();
  if (bootGate) return bootGate;
  bootGate = new Promise<void>((resolve) => {
    const unsub = subscribeBootMorphCompleted((completed) => {
      if (!completed) return;
      unsub();
      resolve();
    });
  });
  return bootGate;
}

export async function prefetchImage(url?: string | null): Promise<void> {
  if (!url) return;
  const normalized = normalizeUrl(url);
  if (!normalized || prefetchedUrls.has(normalized)) return;

  prefetchedUrls.add(normalized);
  try {
    await awaitBootGate();
    const t0 = performance.now();
    await Image.prefetch(normalized, 'memory-disk');
    const duration_ms = Math.round((performance.now() - t0) * 100) / 100;
    log.debug('image.prefetch', { url: normalized.slice(0, 40), duration_ms });
  } catch {
    log.debug('image.prefetch.fail', { url: normalized.slice(0, 40) });
  }
}

export async function prefetchImages(
  urls: Array<string | null | undefined> | undefined
): Promise<void> {
  if (!urls || urls.length === 0) return;
  const newUrls = urls.filter((u) => u && !prefetchedUrls.has(u.trim()));
  if (newUrls.length === 0) return;
  await awaitBootGate();
  const t0 = performance.now();
  await Promise.all(urls.map((url) => prefetchImage(url)));
  const duration_ms = Math.round((performance.now() - t0) * 100) / 100;
  const level = duration_ms > 200 ? 'warn' : 'debug';
  log[level]('image.prefetch.batch', { count: newUrls.length, duration_ms });
}
