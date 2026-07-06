/* eslint-disable import/first */

// Album → unit wallpaper distribution in the theme draft. The built-in
// solid-colour "Colors" album must put EVERY unit on 'dark' (it represents
// "no wallpaper"), while catalog albums cycle their pool newest-first.

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

import { useThemeDraft } from '@/features/theme/lib/themeDraft';
import {
  useWallpaperStore,
  type WallpaperCatalogEntry,
} from '@/shared/stores/global/wallpaperStore';

const UNITS = ['sat', 'usd', 'eur', 'gbp'];

function entry(themeName: string, createdAt: number): WallpaperCatalogEntry {
  return { themeName, albumSlug: 'flowers', createdAt } as unknown as WallpaperCatalogEntry;
}

describe('themeDraft.setAlbum distribution', () => {
  beforeEach(() => {
    useThemeDraft.getState().beginDraft(UNITS);
  });

  it("assigns 'dark' to every unit when the built-in Colors album is applied", () => {
    useThemeDraft.getState().setAlbum('colors', UNITS);

    const { activeAlbumSlug, unitWallpapers } = useThemeDraft.getState();
    expect(activeAlbumSlug).toBe('colors');
    expect(unitWallpapers).toEqual({ sat: 'dark', usd: 'dark', eur: 'dark', gbp: 'dark' });
  });

  it('cycles a catalog album pool newest-first across units', () => {
    useWallpaperStore.setState({
      catalog: [entry('flowers-a', 3), entry('flowers-b', 2), entry('flowers-c', 1)],
    });

    useThemeDraft.getState().setAlbum('flowers', UNITS);

    expect(useThemeDraft.getState().unitWallpapers).toEqual({
      sat: 'flowers-a',
      usd: 'flowers-b',
      eur: 'flowers-c',
      gbp: 'flowers-a',
    });
  });
});
