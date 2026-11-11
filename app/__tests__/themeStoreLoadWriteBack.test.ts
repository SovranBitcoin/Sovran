/**
 * The theme store saves what it loaded straight back after every read that
 * succeeds, and saves nothing after a read that fails: the defaults it then
 * holds must not replace wallpaper choices that could not be read.
 */

/* eslint-disable import/first */

const mockDisk = new Map<string, string>();
const mockRead = { fails: false };
const mockWrites: [string, string][] = [];

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async (key: string) => {
      if (mockRead.fails) throw new Error('Row too big to fit into CursorWindow');
      return mockDisk.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      mockWrites.push([key, value]);
      mockDisk.set(key, value);
    },
    removeItem: async (key: string) => void mockDisk.delete(key),
  }),
}));

import { useThemeStore } from '@/shared/stores/profile/themeStore';

const saved = {
  state: { activeAlbumSlug: 'artemis', unitWallpapers: { sat: 'artemis-3' }, mode: 'light' },
  version: 2,
};

beforeEach(async () => {
  await Promise.resolve();
  mockWrites.length = 0;
  mockRead.fails = false;
  mockDisk.set('theme-store', JSON.stringify(saved));
});

it('saves the loaded choices back once a read succeeds', async () => {
  await useThemeStore.persist.rehydrate();
  await Promise.resolve();

  expect(useThemeStore.getState().activeAlbumSlug).toBe('artemis');
  expect(mockWrites.map(([key, value]) => [key, JSON.parse(value)])).toEqual([
    ['theme-store', saved],
  ]);
});

it('saves nothing after a read that fails', async () => {
  mockRead.fails = true;
  await useThemeStore.persist.rehydrate();
  await Promise.resolve();

  expect(mockWrites).toEqual([]);
  expect(mockDisk.get('theme-store')).toBe(JSON.stringify(saved));
});
