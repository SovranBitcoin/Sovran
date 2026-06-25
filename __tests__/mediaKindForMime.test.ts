/**
 * Media classification by NIP-92 imeta mime (so extensionless Blossom blobs
 * from other clients still render as media) and the IMAGE_EXT extension set.
 */
import { IMAGE_EXT, mediaKindForMime } from '@/features/feed/components/nostr/feedParse';

describe('mediaKindForMime', () => {
  it('maps image/* and video/* to their kind', () => {
    expect(mediaKindForMime('image/jpeg')).toBe('image');
    expect(mediaKindForMime('image/heic')).toBe('image');
    expect(mediaKindForMime('video/mp4')).toBe('video');
  });

  it('returns undefined for unknown, missing, or unrenderable mimes', () => {
    expect(mediaKindForMime(undefined)).toBeUndefined();
    expect(mediaKindForMime('application/octet-stream')).toBeUndefined();
    // expo-image can't render remote SVG, so it must not classify as an image.
    expect(mediaKindForMime('image/svg+xml')).toBeUndefined();
  });
});

describe('IMAGE_EXT', () => {
  it('matches avif and the common raster extensions', () => {
    for (const ext of ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif']) {
      expect(IMAGE_EXT.test(`https://cdn/x.${ext}`)).toBe(true);
    }
  });

  it('does not match svg (renders as a link instead of a blank box)', () => {
    expect(IMAGE_EXT.test('https://cdn/logo.svg')).toBe(false);
  });
});
