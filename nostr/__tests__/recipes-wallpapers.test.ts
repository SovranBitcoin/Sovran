import { describe, expect, it } from 'vitest';

import { parseAlbumCatalog, parseWallpaperEvent } from '../src/recipes/wallpapers';

const NS = 'money.sovran.wallpaper';

function event(overrides: { tags?: string[][]; content?: string } = {}) {
  return {
    id: 'e1',
    pubkey: 'p1',
    kind: 1063,
    created_at: 100,
    content: overrides.content ?? '',
    tags: overrides.tags ?? [],
  };
}

describe('parseWallpaperEvent', () => {
  it('keeps well-formed colour tags and drops malformed ones', () => {
    const entry = parseWallpaperEvent(
      event({
        tags: [
          ['theme_name', 'dusk'],
          ['url', 'https://blossom.example/dusk.jpg'],
          ['palette', '{"500":"#112233"}'],
          ['dominant_colors', '{"not":"an array"}'],
          ['gradient_colors', 'not json'],
          ['l', 'nature', NS],
        ],
      }),
      NS,
    );
    expect(entry).toMatchObject({
      themeName: 'dusk',
      albumSlug: 'nature',
      palette: { '500': '#112233' },
      dominantColors: [],
      gradientColors: [],
    });
  });

  it('returns null without a theme name or url', () => {
    expect(parseWallpaperEvent(event({ tags: [['theme_name', 'x']] }), NS)).toBeNull();
  });
});

describe('parseAlbumCatalog', () => {
  it('drops malformed albums and defaults optional fields', () => {
    const albums = parseAlbumCatalog(
      event({
        content: JSON.stringify({
          albums: [
            { slug: 'nature', displayName: 'Nature', author: { pubkey: 'abc' } },
            { slug: 42 },
          ],
        }),
      }),
    );
    expect(albums).toEqual([
      {
        slug: 'nature',
        displayName: 'Nature',
        description: '',
        sortOrder: 0,
        author: { pubkey: 'abc' },
      },
    ]);
  });

  it.each(['not json', '{"albums":"nope"}', '[]'])('returns [] for %s', (content) => {
    expect(parseAlbumCatalog(event({ content }))).toEqual([]);
  });
});
