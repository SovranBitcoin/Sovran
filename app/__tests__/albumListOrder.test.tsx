/**
 * @jest-environment node
 *
 * The album chooser (`useAlbumList`) and what applying an album assigns
 * (`getCatalogThemesForAlbum`) must agree on an album's wallpapers and their
 * order: newest first, ties in catalog order, the built-in Colors album in
 * its fixed order. An album's cover falls back to its newest wallpaper, and a
 * server album with no wallpapers is not offered.
 */
/* eslint-disable import/first */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { useAlbumList } from '@/features/theme/lib/useAlbumList';
import {
  BUILTIN_COLORS_ALBUM_SLUG,
  BUILTIN_COLOR_THEME_NAMES,
} from '@/shared/lib/theme/builtinAlbums';
import { getCatalogThemesForAlbum } from '@/shared/lib/theme/resolveUnitWallpaper';
import {
  useWallpaperStore,
  type WallpaperCatalogEntry,
} from '@/shared/stores/global/wallpaperStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const wallpaper = (themeName: string, albumSlug: string, createdAt: number) =>
  ({ themeName, albumSlug, createdAt }) as unknown as WallpaperCatalogEntry;
const album = (slug: string, coverThemeName?: string) => ({
  slug,
  displayName: slug,
  description: '',
  sortOrder: 0,
  topic: 'Nature',
  coverThemeName,
});

let list: ReturnType<typeof useAlbumList>;
function Probe() {
  list = useAlbumList();
  return null;
}

beforeEach(() => {
  act(() => {
    useWallpaperStore.setState({
      catalog: [
        wallpaper('old', 'flowers', 1),
        wallpaper('tie-first', 'flowers', 5),
        wallpaper('mid', 'flowers', 3),
        wallpaper('tie-second', 'flowers', 5),
        wallpaper('river', 'water', 2),
      ],
      albums: [album('flowers'), album('water', 'river-cover'), album('empty')],
    } as never);
  });
  act(() => {
    TestRenderer.create(<Probe />);
  });
});

it('lists an album newest first with ties in catalog order, as applying it does', () => {
  const names = list.getAlbumWallpaperNames('flowers');
  expect(names).toEqual(['tie-first', 'tie-second', 'mid', 'old']);
  expect(names).toEqual(getCatalogThemesForAlbum(useWallpaperStore.getState().catalog, 'flowers'));
});

it('lists the Colors album in its fixed order, and nothing for an unknown album', () => {
  expect(list.getAlbumWallpaperNames(BUILTIN_COLORS_ALBUM_SLUG)).toEqual([
    ...BUILTIN_COLOR_THEME_NAMES,
  ]);
  expect(list.getAlbumWallpaperNames('nope')).toEqual([]);
});

it('offers Colors and the albums with wallpapers, covering each with its newest unless it names one', () => {
  expect(list.albums.map((a) => [a.slug, a.coverThemeName, a.newestAt])).toEqual([
    [BUILTIN_COLORS_ALBUM_SLUG, 'dark', 0],
    ['flowers', 'tie-first', 5],
    ['water', 'river-cover', 2],
  ]);
});
