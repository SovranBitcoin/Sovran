/**
 * Merges server-fetched albums with the synthetic Colors album, exposes
 * them both flat and grouped by (topic, author) so each publisher owns
 * their own section inside a topic — other authors can't add to your
 * section even if they happen to use the same topic string.
 */

import { useMemo } from 'react';
import { useWallpaperStore } from '@/shared/stores/global/wallpaperStore';
import {
  BUILTIN_COLORS_ALBUM,
  BUILTIN_COLORS_ALBUM_SLUG,
  BUILTIN_COLOR_THEME_NAMES,
} from '@/shared/lib/theme/builtinAlbums';

const SYSTEM_AUTHOR_KEY = 'system';

export type AlbumAuthor = {
  pubkey: string;
  displayName: string;
  picture: string;
  followers?: number;
};

export interface AlbumListEntry {
  slug: string;
  displayName: string;
  description: string;
  sortOrder: number;
  topic: string;
  coverThemeName: string;
  synthetic: boolean;
  author?: AlbumAuthor | null;
  /** Unix ms of newest wallpaper in album — used for "New" badge heuristic. */
  newestAt: number;
}

interface AlbumGroup {
  /** Stable key: `${topic}::${authorPubkey ?? 'system'}`. */
  key: string;
  topic: string;
  /** Author of all albums in this group (null for the synthetic Colors group). */
  author: AlbumAuthor | null;
  albums: AlbumListEntry[];
}

/** 7-day window counts as "New" for badge display. */
export const NEW_BADGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function useAlbumList(): {
  albums: AlbumListEntry[];
  /** Albums grouped by (topic, author). Each publisher owns their own section. */
  byTopic: AlbumGroup[];
  getAlbum: (slug: string) => AlbumListEntry | undefined;
  getAlbumWallpaperNames: (slug: string) => string[];
} {
  const catalog = useWallpaperStore((s) => s.catalog);
  const serverAlbums = useWallpaperStore((s) => s.albums);

  return useMemo(() => {
    const newestInAlbum: Record<string, number> = {};
    const themesByAlbum: Record<string, string[]> = {};
    const wallpapersByAlbum: Record<string, typeof catalog> = {};

    for (const w of catalog) {
      newestInAlbum[w.albumSlug] = Math.max(newestInAlbum[w.albumSlug] || 0, w.createdAt);
      const albumWallpapers = wallpapersByAlbum[w.albumSlug] ?? [];
      albumWallpapers.push(w);
      wallpapersByAlbum[w.albumSlug] = albumWallpapers;
    }
    for (const [slug, list] of Object.entries(wallpapersByAlbum)) {
      list.sort((a, b) => b.createdAt - a.createdAt);
      themesByAlbum[slug] = list.map((w) => w.themeName);
    }

    const serverEntries: AlbumListEntry[] = serverAlbums.map((a) => {
      const newestWallpaper = wallpapersByAlbum[a.slug]?.[0];
      return {
        slug: a.slug,
        displayName: a.displayName,
        description: a.description,
        sortOrder: a.sortOrder,
        topic: a.topic,
        coverThemeName: a.coverThemeName || newestWallpaper?.themeName || '',
        synthetic: false,
        author: a.author ?? null,
        newestAt: newestInAlbum[a.slug] || 0,
      };
    });

    const syntheticEntries: AlbumListEntry[] = [
      {
        slug: BUILTIN_COLORS_ALBUM.slug,
        displayName: BUILTIN_COLORS_ALBUM.displayName,
        description: BUILTIN_COLORS_ALBUM.description,
        sortOrder: BUILTIN_COLORS_ALBUM.sortOrder,
        topic: BUILTIN_COLORS_ALBUM.topic,
        coverThemeName: BUILTIN_COLORS_ALBUM.coverThemeName || 'dark',
        synthetic: true,
        author: null,
        newestAt: 0,
      },
    ];

    const all = [...syntheticEntries, ...serverEntries].filter(
      (a) => a.synthetic || (themesByAlbum[a.slug]?.length ?? 0) > 0
    );

    // Group by (topic, authorPubkey). Two authors publishing to the same
    // topic string get two separate sections — the section header carries
    // the author's identity so the user can see whose collection they're
    // browsing.
    const groupMap = new Map<string, AlbumGroup>();
    for (const album of all) {
      const authorKey = album.author?.pubkey || SYSTEM_AUTHOR_KEY;
      const key = `${album.topic}::${authorKey}`;
      const existing = groupMap.get(key);
      if (existing) {
        existing.albums.push(album);
      } else {
        groupMap.set(key, {
          key,
          topic: album.topic,
          author: album.author ?? null,
          albums: [album],
        });
      }
    }
    for (const group of groupMap.values()) {
      group.albums.sort((a, b) => a.sortOrder - b.sortOrder);
    }

    // Order sections: synthetic (Basics) first, then by newest wallpaper
    // in the group (most recently updated authors surface higher).
    const byTopic: AlbumGroup[] = [...groupMap.values()].sort((a, b) => {
      const aSynthetic = a.albums.every((x) => x.synthetic);
      const bSynthetic = b.albums.every((x) => x.synthetic);
      if (aSynthetic !== bSynthetic) return aSynthetic ? -1 : 1;
      const aNewest = Math.max(0, ...a.albums.map((x) => x.newestAt));
      const bNewest = Math.max(0, ...b.albums.map((x) => x.newestAt));
      return bNewest - aNewest;
    });

    const getAlbum = (slug: string) => all.find((a) => a.slug === slug);
    const getAlbumWallpaperNames = (slug: string): string[] => {
      if (slug === BUILTIN_COLORS_ALBUM_SLUG) return [...BUILTIN_COLOR_THEME_NAMES];
      return themesByAlbum[slug] || [];
    };

    return { albums: all, byTopic, getAlbum, getAlbumWallpaperNames };
  }, [catalog, serverAlbums]);
}
