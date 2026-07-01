// Wallpaper/theme recipes. Theme events (kind 1063 wallpaper files + kind 30078
// album catalog) are published by the admin pubkey and now indexed by nagg, so
// the read path is a plain events query instead of a bespoke relay subscription.
import type { EventQueryInput } from './rank';

export type NaggWallpaperColors = {
  palette: Record<string, unknown>;
  dominantColors: unknown[];
  gradientColors: unknown[];
};

export type WallpaperCatalogEntry = NaggWallpaperColors & {
  eventId: string;
  themeName: string;
  displayName: string;
  blossomUrl: string;
  thumbUrl: string;
  sha256: string;
  fileSize: number;
  dimensions: string;
  albumSlug: string;
  createdAt: number;
};

export type AlbumMeta = {
  slug: string;
  displayName: string;
  description: string;
  sortOrder: number;
  topic?: string;
  coverThemeName?: string;
};

type RawEventNode = {
  id: string;
  pubkey: string;
  kind: number;
  createdAt: string | number;
  content: string;
  tags: string[][];
};

// The catalog is read with two `eventsQueryAppView` calls (files + albums); the
// caller composes them and parses via `parseWallpaperCatalog` below.

export function wallpaperFilesInput(adminPubkey: string, limit = 500): EventQueryInput {
  return {
    kinds: [1063],
    pubkeys: [adminPubkey],
    tags: [{ key: 't', value: 'wallpaper' }],
    limit,
  };
}

export function wallpaperAlbumsInput(adminPubkey: string): EventQueryInput {
  return {
    kinds: [30078],
    pubkeys: [adminPubkey],
    tags: [{ key: 'd', value: 'wallpaper-catalog' }],
    limit: 1,
  };
}

function toUnixSeconds(value: string | number): number {
  if (typeof value === 'number') return value;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

// parseWallpaperEvent maps a kind-1063 event to a catalog entry. albumNamespace
// is the `l`-tag namespace used to assign an album (caller-supplied to avoid
// coupling nagg-ts to an app constant).
export function parseWallpaperEvent(
  event: RawEventNode,
  albumNamespace: string,
): WallpaperCatalogEntry | null {
  const tags = event.tags ?? [];
  const getTag = (name: string): string | undefined => tags.find((t) => t[0] === name)?.[1];

  const themeName = getTag('theme_name');
  const url = getTag('url');
  if (!themeName || !url) return null;

  const colors: NaggWallpaperColors = { palette: {}, dominantColors: [], gradientColors: [] };
  const parseJson = (raw: string | undefined): unknown => {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  };
  const palette = parseJson(getTag('palette'));
  const dominant = parseJson(getTag('dominant_colors'));
  const gradient = parseJson(getTag('gradient_colors'));
  if (palette && typeof palette === 'object') colors.palette = palette as Record<string, unknown>;
  if (Array.isArray(dominant)) colors.dominantColors = dominant;
  if (Array.isArray(gradient)) colors.gradientColors = gradient;

  const albumTag = tags.find((t) => t[0] === 'l' && t[2] === albumNamespace);
  const albumSlug = albumTag?.[1] || 'uncategorized';

  return {
    eventId: event.id || '',
    themeName,
    displayName: getTag('title') || themeName,
    blossomUrl: url,
    thumbUrl: getTag('thumb') || url,
    sha256: getTag('x') || '',
    fileSize: parseInt(getTag('size') || '0', 10),
    dimensions: getTag('dim') || '',
    albumSlug,
    ...colors,
    createdAt: toUnixSeconds(event.createdAt),
  };
}

// parseAlbumCatalog reads the album list from a kind-30078 event's content JSON.
export function parseAlbumCatalog(event: RawEventNode | undefined): AlbumMeta[] {
  if (!event?.content) return [];
  try {
    const content = JSON.parse(event.content);
    if (content && Array.isArray(content.albums)) {
      return content.albums as AlbumMeta[];
    }
  } catch {
    // Malformed catalog JSON — fall through to empty.
  }
  return [];
}

// parseWallpaperCatalog turns the WALLPAPER_CATALOG_QUERY data into a sorted
// catalog plus albums, mirroring the old /catalog response shape.
export function parseWallpaperCatalog(
  data: { files?: { nodes?: RawEventNode[] }; albums?: { nodes?: RawEventNode[] } },
  albumNamespace: string,
): { wallpapers: WallpaperCatalogEntry[]; albums: AlbumMeta[] } {
  const byTheme = new Map<string, WallpaperCatalogEntry>();
  for (const node of data.files?.nodes ?? []) {
    const entry = parseWallpaperEvent(node, albumNamespace);
    if (!entry) continue;
    const existing = byTheme.get(entry.themeName);
    if (existing && existing.createdAt >= entry.createdAt) continue;
    byTheme.set(entry.themeName, entry);
  }
  const wallpapers = [...byTheme.values()].sort((a, b) => b.createdAt - a.createdAt);

  let albums = parseAlbumCatalog(data.albums?.nodes?.[0]);
  if (albums.length === 0) {
    const slugs = new Set(wallpapers.map((w) => w.albumSlug));
    albums = [...slugs].map((slug) => ({
      slug,
      displayName: slug.charAt(0).toUpperCase() + slug.slice(1),
      description: '',
      sortOrder: 0,
    }));
  }
  return { wallpapers, albums };
}
