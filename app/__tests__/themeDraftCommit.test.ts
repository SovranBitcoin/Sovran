/**
 * @jest-environment node
 *
 * Characterization of the theme draft (`useThemeDraft`) behind the theme
 * Preview / Background / Gallery screens, and above all what Apply
 * (`commit`) does: when it saves to the profile theme store relative to the
 * primary wallpaper's download, which other wallpapers it downloads, and how
 * the draft ends. The real draft, theme store and wallpaper store run; only
 * the wallpaper file download (`wallpaperStorage`) and AsyncStorage are
 * replaced.
 */

import { useThemeDraft } from '@/features/theme/lib/themeDraft';
import {
  BUILTIN_COLORS_ALBUM_SLUG,
  PROFILE_PRIMARY_UNIT_ID,
} from '@/shared/lib/theme/builtinAlbums';
import { FALLBACK_THEME } from '@/shared/lib/theme/resolveUnitWallpaper';
import { downloadWallpaper as downloadWallpaperFile } from '@/shared/lib/wallpaperStorage';
import {
  useWallpaperStore,
  type WallpaperCatalogEntry,
} from '@/shared/stores/global/wallpaperStore';
import { useThemeStore } from '@/shared/stores/profile/themeStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@/shared/lib/wallpaperStorage', () => ({
  downloadWallpaper: jest.fn(
    async (_url: string, themeName: string) => `file:///wallpapers/${themeName}.jpg`
  ),
  isWallpaperDownloaded: jest.fn(async () => true),
  getWallpaperUri: (themeName: string) => `file:///wallpapers/${themeName}.jpg`,
  cleanupOrphanedFiles: jest.fn(async () => undefined),
}));

const mockedDownload = jest.mocked(downloadWallpaperFile);
const PRIMARY = PROFILE_PRIMARY_UNIT_ID;

function entry(themeName: string): WallpaperCatalogEntry {
  const raw: Record<string, unknown> = {
    themeName,
    displayName: themeName,
    blossomUrl: `https://blossom.example/${themeName}.jpg`,
    albumSlug: 'forest',
    palette: {},
    dominantColors: [],
    gradientColors: [],
  };
  return raw as unknown as WallpaperCatalogEntry;
}

function deferred() {
  let resolve: (value: string) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<string>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const draft = () => useThemeDraft.getState();
const theme = () => useThemeStore.getState();

beforeEach(() => {
  mockedDownload.mockClear();
  mockedDownload.mockImplementation(
    async (_url, themeName) => `file:///wallpapers/${themeName}.jpg`
  );
  useWallpaperStore.setState({
    catalog: [entry('pine'), entry('oak'), entry('birch'), entry('elm')],
    downloaded: {},
    activeDownloads: {},
  });
  useThemeStore.setState({ activeAlbumSlug: null, unitWallpapers: {}, mode: 'dark' });
  draft().discard();
});

test('Apply waits for the primary wallpaper download before saving the theme', async () => {
  const pending = deferred();
  mockedDownload.mockImplementationOnce(() => pending.promise);
  draft().beginDraft();
  draft().setUnitWallpaper(PRIMARY, 'pine');

  const applying = draft().commit();
  await Promise.resolve();
  expect(mockedDownload).toHaveBeenCalledWith(
    'https://blossom.example/pine.jpg',
    'pine',
    expect.any(Function)
  );
  expect(theme().unitWallpapers).toEqual({});

  pending.resolve('file:///wallpapers/pine.jpg');
  await applying;
  expect(theme().unitWallpapers).toEqual({ [PRIMARY]: 'pine' });
});

test('Apply saves the album, every unit wallpaper and the mode, then ends the draft', async () => {
  draft().beginDraft();
  draft().setUnitWallpaper(PRIMARY, 'pine');
  draft().setUnitWallpaper('usd', 'oak');
  draft().setMode('light');
  useThemeDraft.setState({ activeAlbumSlug: 'forest' });

  await draft().commit();

  expect(theme()).toMatchObject({
    activeAlbumSlug: 'forest',
    unitWallpapers: { [PRIMARY]: 'pine', usd: 'oak' },
    mode: 'light',
  });
  expect(draft()).toMatchObject({
    active: false,
    activeAlbumSlug: null,
    unitWallpapers: {},
    mode: 'dark',
  });
});

test('the other units’ wallpapers are downloaded once each, skipping the primary and ones already on the phone', async () => {
  useWallpaperStore.setState({
    downloaded: {
      birch: { ...entry('birch'), localUri: 'file:///wallpapers/birch.jpg', downloadedAt: 1 },
    },
  });
  draft().beginDraft();
  draft().setUnitWallpaper(PRIMARY, 'pine');
  draft().setUnitWallpaper('usd', 'oak');
  draft().setUnitWallpaper('eur', 'oak');
  draft().setUnitWallpaper('gbp', 'birch');
  draft().setUnitWallpaper('jpy', 'pine');
  draft().setUnitWallpaper('chf', 'not-in-catalog');

  await draft().commit();
  await Promise.resolve();

  expect(mockedDownload.mock.calls.map(([, name]) => name).sort()).toEqual(['oak', 'pine']);
});

test('a primary already on the phone is not downloaded again', async () => {
  useWallpaperStore.setState({
    downloaded: {
      pine: { ...entry('pine'), localUri: 'file:///wallpapers/pine.jpg', downloadedAt: 1 },
    },
  });
  draft().beginDraft();
  draft().setUnitWallpaper(PRIMARY, 'pine');

  await draft().commit();

  expect(mockedDownload).not.toHaveBeenCalled();
  expect(theme().unitWallpapers).toEqual({ [PRIMARY]: 'pine' });
});

test('Apply saves the theme even when the primary wallpaper download failed, and does not retry it', async () => {
  mockedDownload.mockRejectedValueOnce(new Error('blossom unreachable'));
  draft().beginDraft();
  draft().setUnitWallpaper(PRIMARY, 'pine');

  await expect(draft().commit()).resolves.toBe(true);

  // QUIRK (D3): the failed download is swallowed and the wallpaper is saved
  // anyway, so the chrome never switches to it and nothing downloads it later.
  // A fix should keep the draft open and report the failure instead.
  expect(theme().unitWallpapers).toEqual({ [PRIMARY]: 'pine' });
  expect(useWallpaperStore.getState().downloaded.pine).toBeUndefined();
  expect(mockedDownload).toHaveBeenCalledTimes(1);
  expect(draft().active).toBe(false);
});

test('Cancel during the primary download leaves the saved theme as it was', async () => {
  useThemeStore.setState({
    activeAlbumSlug: null,
    unitWallpapers: { [PRIMARY]: 'oak' },
    mode: 'dark',
  });
  const pending = deferred();
  mockedDownload.mockImplementationOnce(() => pending.promise);
  draft().beginDraft();
  draft().setUnitWallpaper(PRIMARY, 'pine');
  draft().setMode('light');

  const applying = draft().commit();
  await Promise.resolve();
  draft().discard();
  pending.resolve('file:///wallpapers/pine.jpg');

  const applied = await applying;
  expect(theme()).toMatchObject({ unitWallpapers: { [PRIMARY]: 'oak' }, mode: 'dark' });
  expect(draft().active).toBe(false);
  // Apply reports that nothing was applied, so the screen does not navigate again.
  expect(applied).toBe(false);
});

test('a cancelled Apply that finishes late leaves a draft opened since alone', async () => {
  const pending = deferred();
  mockedDownload.mockImplementationOnce(() => pending.promise);
  draft().beginDraft();
  draft().setUnitWallpaper(PRIMARY, 'pine');

  const applying = draft().commit();
  await Promise.resolve();
  draft().discard();
  draft().beginDraft();
  draft().setUnitWallpaper(PRIMARY, 'birch');
  pending.resolve('file:///wallpapers/pine.jpg');

  const applied = await applying;
  expect(theme().unitWallpapers).toEqual({});
  expect(draft()).toMatchObject({ active: true, unitWallpapers: { [PRIMARY]: 'birch' } });
  expect(applied).toBe(false);
});

test('a primary wallpaper missing from the catalog is saved without a download', async () => {
  draft().beginDraft();
  draft().setUnitWallpaper(PRIMARY, 'gone');

  await draft().commit();

  expect(mockedDownload).not.toHaveBeenCalled();
  expect(theme().unitWallpapers).toEqual({ [PRIMARY]: 'gone' });
});

test('a draft starts as the saved theme and is dirty only after a change', () => {
  useThemeStore.setState({
    activeAlbumSlug: 'forest',
    unitWallpapers: { [PRIMARY]: 'pine' },
    mode: 'light',
  });
  draft().beginDraft();
  expect(draft()).toMatchObject({ active: true, activeAlbumSlug: 'forest', mode: 'light' });
  expect(draft().isDirty()).toBe(false);

  draft().setUnitWallpaper(PRIMARY, 'oak');
  expect(draft().isDirty()).toBe(true);
  expect(draft().resolveUnitTheme(PRIMARY)).toBe('oak');
});

test('choosing the solid-colour album puts every unit on the fallback palette', () => {
  draft().beginDraft();
  draft().setAlbum(BUILTIN_COLORS_ALBUM_SLUG, [PRIMARY, 'usd']);

  expect(draft().unitWallpapers).toEqual({ [PRIMARY]: FALLBACK_THEME, usd: FALLBACK_THEME });
});

test('discard leaves the saved theme as it was', () => {
  useThemeStore.setState({
    activeAlbumSlug: null,
    unitWallpapers: { [PRIMARY]: 'pine' },
    mode: 'dark',
  });
  draft().beginDraft();
  draft().setUnitWallpaper(PRIMARY, 'oak');
  draft().discard();

  expect(theme().unitWallpapers).toEqual({ [PRIMARY]: 'pine' });
  expect(draft().active).toBe(false);
});
