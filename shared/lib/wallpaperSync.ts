import { log } from '@/shared/lib/logger';
import {
  useWallpaperStore,
  type WallpaperCatalogEntry,
} from '@/shared/stores/global/wallpaperStore';
import { fetchWallpaperCatalog } from '@/shared/lib/apiClient';
import { PUBLIC_KEYS } from '@/shared/lib/constants';

/**
 * Refresh the wallpaper catalog from the API. `signal` aborts the fetch
 * if the caller goes away before the catalog lands.
 *
 * The API may carry albums published by third-party pubkeys (NIP-32 wallpaper
 * events from anyone using the `money.sovran.wallpaper` namespace). We drop
 * anything whose `author.pubkey` is set and doesn't match Sovran's own
 * pubkey so the gallery only surfaces officially-published themes. Albums
 * with no `author` are treated as system-curated and kept.
 */
export async function refreshCatalog(signal?: AbortSignal): Promise<boolean> {
  const result = await fetchWallpaperCatalog({ signal });

  if (result.isErr()) {
    log.warn('wallpaper.sync.catalog_failed', { error: result.error.message });
    return false;
  }

  const { wallpapers, albums } = result.value;

  // Hex pubkeys are case-insensitive on the wire — some relays / publishers
  // round-trip them upper- or mixed-case. Normalise both sides before
  // comparing so a casing mismatch doesn't drop legitimate Sovran albums.
  const SOVRAN_PUBKEY = PUBLIC_KEYS.SUPPORT.toLowerCase();
  const isSovran = (pubkey: string | undefined | null) =>
    !pubkey || pubkey.toLowerCase() === SOVRAN_PUBKEY;

  const filteredAlbums = albums.filter((a) => isSovran(a.author?.pubkey));
  // Wallpapers are dropped ONLY when their `albumSlug` matches an album we
  // explicitly removed for a non-Sovran pubkey. Orphan slugs that don't
  // appear in any album in the response (e.g. `uncategorized`) are kept —
  // those are server-side bookkeeping artefacts, not third-party content.
  const removedSlugs = new Set(
    albums.filter((a) => !isSovran(a.author?.pubkey)).map((a) => a.slug)
  );
  const filteredWallpapers = wallpapers.filter((w) => !removedSlugs.has(w.albumSlug));

  const droppedAlbums = albums.length - filteredAlbums.length;
  const droppedWallpapers = wallpapers.length - filteredWallpapers.length;
  if (droppedAlbums > 0 || droppedWallpapers > 0) {
    // Surface which authors got dropped so a mismatch is debuggable from the
    // log stream — listing distinct pubkeys (truncated) + display names.
    const droppedAuthors = Array.from(
      new Map(
        albums
          .filter((a) => !isSovran(a.author?.pubkey))
          .map((a) => [
            a.author?.pubkey ?? '<no-pubkey>',
            a.author?.displayName ?? '<no-name>',
          ])
      ).entries()
    ).map(([pubkey, name]) => `${name}:${pubkey.slice(0, 12)}…`);

    log.info('wallpaper.sync.filtered_non_sovran', {
      droppedAlbums,
      droppedWallpapers,
      keptAlbums: filteredAlbums.length,
      keptWallpapers: filteredWallpapers.length,
      droppedAuthors,
      expectedSovranPubkey: SOVRAN_PUBKEY.slice(0, 12) + '…',
    });
  }

  // Schema palette is typed as Record<string, string>; the app's WallpaperCatalogEntry
  // narrows it to the specific shade-keyed ThemePalette. JSON shape matches.
  useWallpaperStore
    .getState()
    .setCatalog(filteredWallpapers as WallpaperCatalogEntry[], filteredAlbums);
  return true;
}
