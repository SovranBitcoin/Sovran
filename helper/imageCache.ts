import { Image } from 'expo-image';

const prefetchedUrls = new Set<string>();

function normalizeUrl(url: string): string {
  return url.trim();
}

export async function prefetchImage(url?: string | null): Promise<void> {
  if (!url) return;
  const normalized = normalizeUrl(url);
  if (!normalized || prefetchedUrls.has(normalized)) return;

  prefetchedUrls.add(normalized);
  try {
    await Image.prefetch(normalized, 'memory-disk');
  } catch {
    // Ignore cache warm failures; rendering still proceeds normally.
  }
}

export async function prefetchImages(
  urls: Array<string | null | undefined> | undefined
): Promise<void> {
  if (!urls || urls.length === 0) return;
  await Promise.all(urls.map((url) => prefetchImage(url)));
}
