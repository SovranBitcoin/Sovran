/**
 * NIP-92 imeta tag parsing (feed media display). Round-trips with the
 * write-side `buildImetaTag` so dimensions/alt reach the renderer.
 */
import { parseImetaTags } from '@/shared/lib/nostr/media/imeta';
import { buildImetaTag } from '@/shared/lib/nostr/media/imeta';

describe('parseImetaTags', () => {
  it('parses url, mime, dim, alt, blurhash', () => {
    const map = parseImetaTags([
      [
        'imeta',
        'url https://cdn/x.jpg',
        'm image/jpeg',
        'dim 800x600',
        'alt a cat',
        'blurhash LKO2',
      ],
    ]);
    expect(map.get('https://cdn/x.jpg')).toEqual({
      url: 'https://cdn/x.jpg',
      mimeType: 'image/jpeg',
      width: 800,
      height: 600,
      alt: 'a cat',
      blurhash: 'LKO2',
    });
  });

  it('ignores non-imeta tags and malformed dim', () => {
    const map = parseImetaTags([
      ['p', 'somebody'],
      ['imeta', 'url https://cdn/y.png', 'dim notdims'],
    ]);
    expect(map.size).toBe(1);
    const info = map.get('https://cdn/y.png');
    expect(info?.width).toBeUndefined();
  });

  it('round-trips with buildImetaTag', () => {
    const tag = buildImetaTag({
      url: 'https://cdn/z.jpg',
      sha256: 'abc',
      mimeType: 'image/jpeg',
      width: 1024,
      height: 768,
      alt: 'sunset',
    });
    const info = parseImetaTags([tag]).get('https://cdn/z.jpg');
    expect(info).toMatchObject({ mimeType: 'image/jpeg', width: 1024, height: 768, alt: 'sunset' });
  });
});
