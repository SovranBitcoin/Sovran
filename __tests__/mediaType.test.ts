/**
 * Media MIME ↔ extension resolution and the renderable-URL guarantee that fixes
 * bare-hash Blossom URLs failing to inline-render in Nostr clients.
 */
import {
  ensureUrlExtension,
  extensionForMime,
  resolveMediaType,
} from '@/shared/lib/nostr/media/mediaType';

const PRIMAL = 'https://blossom.primal.net';
const HASH = '42caeea8a44aa9a57f6e68ce7752dba858de463dc79c53f6adf0e9b120fccd5e';

describe('resolveMediaType', () => {
  it('prefers the file name over a wrong picker mime', () => {
    // A PNG screenshot the picker mislabels as JPEG: the name wins, both agree.
    expect(resolveMediaType({ fileName: 'IMG_001.png', mimeType: 'image/jpeg' })).toEqual({
      extension: 'png',
      mimeType: 'image/png',
    });
  });

  it('falls back to the uri extension when there is no file name', () => {
    expect(resolveMediaType({ uri: 'file:///tmp/ImagePicker/abc.heic' })).toEqual({
      extension: 'heic',
      mimeType: 'image/heic',
    });
  });

  it('derives the extension from the mime when name and uri are extensionless', () => {
    expect(resolveMediaType({ uri: 'file:///tmp/ph-asset', mimeType: 'video/quicktime' })).toEqual({
      extension: 'mov',
      mimeType: 'video/quicktime',
    });
  });

  it('falls back by kind when nothing else resolves a type', () => {
    expect(resolveMediaType({ uri: 'ph://no-extension', kind: 'image' })).toEqual({
      extension: 'jpg',
      mimeType: 'image/jpeg',
    });
    expect(resolveMediaType({ uri: 'ph://no-extension', kind: 'video' })).toEqual({
      extension: 'mp4',
      mimeType: 'video/mp4',
    });
  });

  it('ignores a query string when reading the uri extension', () => {
    expect(resolveMediaType({ uri: 'https://x/y.webp?dl=1' }).extension).toBe('webp');
  });
});

describe('extensionForMime', () => {
  it('maps known mimes and ignores unknown ones', () => {
    expect(extensionForMime('image/gif')).toBe('gif');
    expect(extensionForMime('application/octet-stream')).toBeUndefined();
    expect(extensionForMime(undefined)).toBeUndefined();
  });

  it('prefers jpg over jpeg for image/jpeg', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg');
  });
});

describe('ensureUrlExtension', () => {
  it('appends the extension to a bare-hash Blossom url (the bug)', () => {
    expect(ensureUrlExtension(`${PRIMAL}/${HASH}`, 'png')).toBe(`${PRIMAL}/${HASH}.png`);
  });

  it('leaves a url that already has a known media extension untouched', () => {
    const withExt = `${PRIMAL}/${HASH}.jpg`;
    expect(ensureUrlExtension(withExt, 'jpg')).toBe(withExt);
  });
});
