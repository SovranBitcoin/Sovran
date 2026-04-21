/**
 * Built-in synthetic albums.
 *
 * The "Colors" album wraps `BASE_THEMES` (solid palette themes) so they
 * participate in the album/topic UI like any Nostr-published wallpaper album.
 * No catalog entries exist for these — consumers detect them via the
 * `slug: BUILTIN_COLORS_ALBUM_SLUG` and render a gradient preview from the
 * theme's palette rather than a downloaded image.
 */

export const BUILTIN_COLORS_ALBUM_SLUG = 'colors';
export const BUILTIN_BASICS_TOPIC = 'Basics';

/** The wallet's primary unit ID — matches WalletScreen.ACCOUNTS[0].unit. */
export const PROFILE_PRIMARY_UNIT_ID = 'sat';

export interface BuiltinColorTheme {
  name: string;
  displayName: string;
}

export const BUILTIN_COLOR_THEMES: readonly BuiltinColorTheme[] = [
  { name: 'dark', displayName: 'Dark' },
  { name: 'navy', displayName: 'Navy' },
  { name: 'sunset', displayName: 'Sunset' },
  { name: 'beige', displayName: 'Beige' },
  { name: 'crimson-night', displayName: 'Crimson Night' },
  { name: 'twilight-amber', displayName: 'Twilight Amber' },
  { name: 'velvet-emerald', displayName: 'Velvet Emerald' },
] as const;

export const BUILTIN_COLOR_THEME_NAMES = BUILTIN_COLOR_THEMES.map((t) => t.name);

export function isBuiltinColorTheme(themeName: string): boolean {
  return BUILTIN_COLOR_THEME_NAMES.includes(themeName);
}

export interface SyntheticAlbumMeta {
  slug: string;
  displayName: string;
  description: string;
  sortOrder: number;
  topic: string;
  coverThemeName?: string;
  synthetic: true;
  author?: null;
}

export const BUILTIN_COLORS_ALBUM: SyntheticAlbumMeta = {
  slug: BUILTIN_COLORS_ALBUM_SLUG,
  displayName: 'Colors',
  description: 'Solid colour palettes',
  sortOrder: -1,
  topic: BUILTIN_BASICS_TOPIC,
  coverThemeName: 'dark',
  synthetic: true,
  author: null,
};
