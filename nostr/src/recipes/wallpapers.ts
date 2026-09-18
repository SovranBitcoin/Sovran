// Wallpaper/theme recipes. Theme events (kind 1063 wallpaper files + kind 30078
// album catalog) are published by the admin pubkey and now indexed by nagg, so
// the read path is a plain events query instead of a bespoke relay subscription.
import { z } from 'zod';

import type { EventQueryInput } from './rank';

// Tag and content JSON is untrusted relay data, so it is parsed with these
// schemas at the boundary. They check structure only: per-colour and per-URL
// constraints belong to the consumer's `@sovranbitcoin/schemas` catalog schema,
// which this package doesn't import as a value (see `../schemas.ts` for why).
const PaletteSchema = z.record(z.string(), z.unknown());
const ColorListSchema = z.array(z.unknown());

const NaggWallpaperColorsSchema = z.object({
  palette: PaletteSchema,
  dominantColors: ColorListSchema,
  gradientColors: ColorListSchema,
});

export type NaggWallpaperColors = z.infer<typeof NaggWallpaperColorsSchema>;

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

// Loose so extra publisher fields (e.g. `author`) reach the consumer, which
// filters on them.
const AlbumMetaSchema = z.looseObject({
  slug: z.string(),
  displayName: z.string(),
  description: z.string().default(''),
  sortOrder: z.number().default(0),
  topic: z.string().optional(),
  coverThemeName: z.string().optional(),
});

export type AlbumMeta = z.infer<typeof AlbumMetaSchema>;

const AlbumCatalogContentSchema = z.object({ albums: z.array(z.unknown()) });

type RawEventNode = {
  id: string;
  pubkey: string;
  kind: number;
  /** GraphQL-era camelCase timestamp; the v2 envelope carries `created_at`. */
  createdAt?: string | number;
  created_at?: number;
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

/** JSON.parse that yields `undefined` for malformed text; callers validate. */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function toUnixSeconds(value: string | number | undefined): number {
  if (typeof value === 'number') return value;
  if (value === undefined) return 0;
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

  const parseJsonTag = <T>(name: string, schema: z.ZodType<T>, fallback: T): T => {
    const raw = getTag(name);
    if (!raw) return fallback;
    const parsed = schema.safeParse(parseJson(raw));
    return parsed.success ? parsed.data : fallback;
  };
  const colors: NaggWallpaperColors = {
    palette: parseJsonTag('palette', PaletteSchema, {}),
    dominantColors: parseJsonTag('dominant_colors', ColorListSchema, []),
    gradientColors: parseJsonTag('gradient_colors', ColorListSchema, []),
  };

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
    createdAt: event.created_at ?? toUnixSeconds(event.createdAt),
  };
}

// parseAlbumCatalog reads the album list from a kind-30078 event's content JSON.
// Malformed content yields no albums; malformed album entries are dropped.
export function parseAlbumCatalog(event: RawEventNode | undefined): AlbumMeta[] {
  if (!event?.content) return [];
  const content = AlbumCatalogContentSchema.safeParse(parseJson(event.content));
  if (!content.success) return [];
  return content.data.albums.flatMap((album) => {
    const parsed = AlbumMetaSchema.safeParse(album);
    return parsed.success ? [parsed.data] : [];
  });
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
