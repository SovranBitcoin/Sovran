import { Image } from 'expo-image';
import { registerAccountScoped } from '@/shared/lib/account/accountRegistry';
import { log } from '@/shared/lib/logger';
import { getBootMorphCompleted, subscribeBootMorphCompleted } from '@/shared/lib/qrButtonAnchor';

const prefetchedUrls = new Set<string>();
const MAX_PREFETCHED_URLS = 512;
const MAX_CONCURRENT_PREFETCHES = 4;
/**
 * How many prefetches may wait for a slot. A long list scrolled quickly asks
 * for far more images than it will show; past this, the oldest request still
 * waiting is given up, since what was asked for most recently is what is on
 * screen.
 */
const MAX_WAITING_PREFETCHES = 64;
/** How long prefetching waits for the boot animation before going ahead without it. */
const BOOT_GATE_MAX_MS = 8_000;
const inflight = new Map<string, Promise<void>>();
const waiting: ((granted: boolean) => void)[] = [];
let activePrefetches = 0;

/** Resolves true with a slot held, or false when the request was given up while waiting. */
async function acquirePrefetchSlot(): Promise<boolean> {
  if (activePrefetches < MAX_CONCURRENT_PREFETCHES) {
    activePrefetches += 1;
    return true;
  }
  if (waiting.length >= MAX_WAITING_PREFETCHES) waiting.shift()?.(false);
  return new Promise<boolean>((resolve) => waiting.push(resolve));
}

function releasePrefetchSlot(): void {
  const next = waiting.shift();
  if (next) next(true);
  else activePrefetches -= 1;
}

/**
 * Give up every prefetch still waiting for a slot. Called when the account
 * changes: the images were wanted by screens that are gone. Requests already
 * with the native loader run to their end.
 */
export function discardQueuedPrefetches(): void {
  for (const giveUp of waiting.splice(0)) giveUp(false);
}
registerAccountScoped('image.prefetch-queue', discardQueuedPrefetches, () => waiting.length === 0);

function normalizeUrl(url: string): string {
  return url.trim();
}

// Most prefetch callers feed URLs from untrusted nostr kind-0 metadata
// (`picture`, `icon_url`). Restrict to https/http so a relay-supplied
// `javascript:` / `data:` / `file:` / `chrome:` URL never reaches the
// image loader. http is permitted (some self-hosted mints publish
// http-only logos) but logged so it's visible in log-doctor.
export function isSafeImageUrl(url: string): boolean {
  try {
    const proto = new URL(url).protocol;
    return proto === 'https:' || proto === 'http:';
  } catch {
    return false;
  }
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
    const open = () => {
      clearTimeout(giveUp);
      unsub();
      resolve();
    };
    const unsub = subscribeBootMorphCompleted((completed) => {
      if (completed) open();
    });
    // The animation may never report: the app opened on onboarding, or on a
    // failure screen. Prefetching then goes ahead after a wait instead of
    // staying parked for the session.
    const giveUp = setTimeout(open, BOOT_GATE_MAX_MS);
  });
  return bootGate;
}

export function prefetchImage(url?: string | null): Promise<void> {
  if (!url) return Promise.resolve();
  const normalized = normalizeUrl(url);
  if (!normalized || prefetchedUrls.has(normalized)) return Promise.resolve();
  const pending = inflight.get(normalized);
  if (pending) return pending;
  if (!isSafeImageUrl(normalized)) {
    log.warn('image.prefetch.rejected_scheme', { url: normalized.slice(0, 40) });
    return Promise.resolve();
  }

  const request = runPrefetch(normalized).finally(() => inflight.delete(normalized));
  inflight.set(normalized, request);
  return request;
}

async function runPrefetch(normalized: string): Promise<void> {
  await awaitBootGate();
  if (!(await acquirePrefetchSlot())) return;
  try {
    const t0 = performance.now();
    const succeeded = await Image.prefetch(normalized, 'memory-disk');
    if (succeeded) {
      prefetchedUrls.add(normalized);
      if (prefetchedUrls.size > MAX_PREFETCHED_URLS) {
        const oldest = prefetchedUrls.values().next().value;
        if (oldest !== undefined) prefetchedUrls.delete(oldest);
      }
    }
    const duration_ms = Math.round((performance.now() - t0) * 100) / 100;
    log.debug('image.prefetch', { url: normalized.slice(0, 40), duration_ms, succeeded });
  } catch {
    log.debug('image.prefetch.fail', { url: normalized.slice(0, 40) });
  } finally {
    releasePrefetchSlot();
  }
}

export async function prefetchImages(
  urls: (string | null | undefined)[] | undefined
): Promise<void> {
  if (!urls || urls.length === 0) return;
  const newUrls = urls.filter((u) => u && !prefetchedUrls.has(u.trim()));
  if (newUrls.length === 0) return;
  await awaitBootGate();
  const t0 = performance.now();
  await Promise.all(newUrls.map((url) => prefetchImage(url)));
  const duration_ms = Math.round((performance.now() - t0) * 100) / 100;
  const level = duration_ms > 200 ? 'warn' : 'debug';
  log[level]('image.prefetch.batch', { count: newUrls.length, duration_ms });
}
