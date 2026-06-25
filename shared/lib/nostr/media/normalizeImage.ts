/**
 * @fileoverview Make a picked image blob web-safe and metadata-free before upload.
 *
 * Two jobs, both by re-encoding through the native image pipeline:
 *  1. Privacy — camera photos and screenshots carry EXIF, including GPS
 *     location, capture time, and device model. Re-encoding drops all of it
 *     before the bytes ever reach the public Blossom server / public note.
 *  2. Interop — HEIC/HEIF (iPhone camera default) renders almost nowhere, so
 *     it is transcoded to JPEG. Re-encoding also bakes in EXIF orientation, so
 *     the `imeta` `dim` we publish matches how the image actually displays.
 *
 * Raster formats that can carry EXIF/GPS are re-encoded (HEIC/HEIF → JPEG,
 * JPEG → JPEG, PNG → PNG to preserve transparency, WebP → JPEG). WebP is a
 * common Android camera/screenshot output and supports an EXIF chunk, so it is
 * re-encoded too (which flattens animated WebP — an acceptable trade for not
 * leaking GPS). GIF passes through untouched: it is not a camera format and
 * re-encoding would flatten its animation.
 */
import { ImageManipulator, SaveFormat, type ImageResult } from 'expo-image-manipulator';
import { ResultAsync, okAsync } from 'neverthrow';

import { nostrLog } from '@/shared/lib/logger';
import type { PickedAsset } from '@/shared/lib/nostr/media/mediaUpload';

export type NormalizeImageError = { type: 'convert-failed' };

/** JPEG quality for re-encoded photos (0–1); high enough to avoid visible artifacts. */
const JPEG_COMPRESS = 0.9;

interface Target {
  format: SaveFormat;
  mimeType: string;
}

const JPEG_TARGET: Target = { format: SaveFormat.JPEG, mimeType: 'image/jpeg' };
const PNG_TARGET: Target = { format: SaveFormat.PNG, mimeType: 'image/png' };

const HEIC = { mime: /^image\/hei[cf](-sequence)?$/i, ext: /\.hei[cf](\?.*)?$/i };
const JPEG = { mime: /^image\/jpe?g$/i, ext: /\.jpe?g(\?.*)?$/i };
const PNG = { mime: /^image\/png$/i, ext: /\.png(\?.*)?$/i };
const WEBP = { mime: /^image\/webp$/i, ext: /\.webp(\?.*)?$/i };

/**
 * The format to re-encode `asset` into, or `null` to pass it through. HEIC/HEIF
 * and WebP become JPEG (interop + metadata strip); JPEG/PNG re-encode in place
 * purely to strip metadata. Anything else (e.g. GIF) passes through.
 */
function reencodeTarget(asset: PickedAsset): Target | null {
  const { mimeType: m, uri } = asset;
  if (HEIC.mime.test(m) || HEIC.ext.test(uri)) return JPEG_TARGET;
  if (JPEG.mime.test(m) || JPEG.ext.test(uri)) return JPEG_TARGET;
  if (PNG.mime.test(m) || PNG.ext.test(uri)) return PNG_TARGET;
  if (WEBP.mime.test(m) || WEBP.ext.test(uri)) return JPEG_TARGET;
  return null;
}

async function reencode(uri: string, target: Target): Promise<ImageResult> {
  const rendered = await ImageManipulator.manipulate(uri).renderAsync();
  return rendered.saveAsync({ format: target.format, compress: JPEG_COMPRESS });
}

/**
 * Returns a web-safe, metadata-stripped variant of `asset`. Photographic
 * formats are re-encoded (dropping EXIF/GPS and normalizing orientation);
 * animated/other formats are returned unchanged.
 */
export function normalizeImageAsset(
  asset: PickedAsset
): ResultAsync<PickedAsset, NormalizeImageError> {
  const target = reencodeTarget(asset);
  if (!target) return okAsync(asset);

  return ResultAsync.fromPromise(reencode(asset.uri, target), () => {
    nostrLog.warn('nostr.media.normalize_failed', { from: asset.mimeType });
    return { type: 'convert-failed' as const };
  }).map((result) => {
    nostrLog.info('nostr.media.normalized', {
      from: asset.mimeType,
      to: target.mimeType,
      w: result.width,
      h: result.height,
    });
    return {
      uri: result.uri,
      mimeType: target.mimeType,
      width: result.width,
      height: result.height,
    };
  });
}
