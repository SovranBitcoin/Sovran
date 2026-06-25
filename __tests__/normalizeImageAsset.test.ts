/**
 * Web-safe image normalization: HEIC/HEIF picked assets transcode to JPEG;
 * already-renderable images and videos pass through untouched. The native
 * `expo-image-manipulator` chain and the logger are mocked so the routing and
 * descriptor rewriting can be asserted deterministically.
 */
/* eslint-disable import/first */

// The mocks live inside the factory to avoid the import-hoisting TDZ; handles
// are retrieved via `jest.requireMock` below.
jest.mock(
  'expo-image-manipulator',
  () => {
    const saveAsync = jest.fn(async () => ({ uri: 'file:///out.jpg', width: 800, height: 600 }));
    const renderAsync = jest.fn(async () => ({ saveAsync }));
    const manipulate = jest.fn(() => ({ renderAsync }));
    return {
      __esModule: true,
      ImageManipulator: { manipulate },
      SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
      __mocks: { manipulate, renderAsync, saveAsync },
    };
  },
  { virtual: true }
);

jest.mock('@/shared/lib/logger', () => ({
  __esModule: true,
  nostrLog: { info: jest.fn(), warn: jest.fn() },
}));

import { normalizeImageAsset } from '@/shared/lib/nostr/media/normalizeImage';
import type { PickedAsset } from '@/shared/lib/nostr/media/mediaUpload';

const {
  manipulate: mockManipulate,
  renderAsync: mockRenderAsync,
  saveAsync: mockSaveAsync,
} = (jest.requireMock('expo-image-manipulator') as { __mocks: Record<string, jest.Mock> }).__mocks;

beforeEach(() => {
  mockManipulate.mockClear();
  mockRenderAsync.mockClear();
  mockSaveAsync.mockClear();
});

describe('normalizeImageAsset', () => {
  it('transcodes an HEIC image (by mime) to JPEG with updated uri/mime/dims', async () => {
    const asset: PickedAsset = {
      uri: 'file:///photo',
      mimeType: 'image/heic',
      width: 3024,
      height: 4032,
    };
    const result = await normalizeImageAsset(asset);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      uri: 'file:///out.jpg',
      mimeType: 'image/jpeg',
      width: 800,
      height: 600,
    });
    expect(mockManipulate).toHaveBeenCalledWith('file:///photo');
    expect(mockSaveAsync).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.9 });
  });

  it('transcodes when only the uri has a .heic extension (mime fell back to jpeg)', async () => {
    const asset: PickedAsset = { uri: 'file:///IMG_0001.HEIC', mimeType: 'image/jpeg' };
    const result = await normalizeImageAsset(asset);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().mimeType).toBe('image/jpeg');
    expect(mockManipulate).toHaveBeenCalledTimes(1);
  });

  it('re-encodes a JPEG in place to strip EXIF (stays image/jpeg)', async () => {
    const asset: PickedAsset = {
      uri: 'file:///shot.jpg',
      mimeType: 'image/jpeg',
      width: 960,
      height: 837,
    };
    const result = await normalizeImageAsset(asset);

    expect(result._unsafeUnwrap().mimeType).toBe('image/jpeg');
    expect(mockManipulate).toHaveBeenCalledWith('file:///shot.jpg');
    expect(mockSaveAsync).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.9 });
  });

  it('re-encodes a PNG as PNG (preserves transparency) to strip EXIF', async () => {
    const asset: PickedAsset = { uri: 'file:///screenshot.png', mimeType: 'image/png' };
    const result = await normalizeImageAsset(asset);

    expect(result._unsafeUnwrap().mimeType).toBe('image/png');
    expect(mockSaveAsync).toHaveBeenCalledWith({ format: 'png', compress: 0.9 });
  });

  it('re-encodes WebP to JPEG to strip EXIF (WebP is an Android camera format)', async () => {
    const asset: PickedAsset = { uri: 'file:///pixel.webp', mimeType: 'image/webp' };
    const result = await normalizeImageAsset(asset);

    expect(result._unsafeUnwrap().mimeType).toBe('image/jpeg');
    expect(mockManipulate).toHaveBeenCalledWith('file:///pixel.webp');
    expect(mockSaveAsync).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.9 });
  });

  it('passes an animated format (GIF) through untouched to keep animation', async () => {
    const asset: PickedAsset = { uri: 'file:///loop.gif', mimeType: 'image/gif' };
    const result = await normalizeImageAsset(asset);

    expect(result._unsafeUnwrap()).toBe(asset);
    expect(mockManipulate).not.toHaveBeenCalled();
  });

  it('returns a convert-failed error when the manipulator throws', async () => {
    mockRenderAsync.mockRejectedValueOnce(new Error('decode failed'));
    const asset: PickedAsset = { uri: 'file:///photo.heic', mimeType: 'image/heic' };
    const result = await normalizeImageAsset(asset);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({ type: 'convert-failed' });
  });
});
