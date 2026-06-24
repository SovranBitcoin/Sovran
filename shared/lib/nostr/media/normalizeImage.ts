/**
 * @fileoverview Make a picked image blob web-safe before upload.
 *
 * iPhone camera photos arrive as HEIC/HEIF, which most Nostr clients (and
 * Sovran's own extension-based feed image detection) cannot render. This
 * transcodes HEIC/HEIF assets to JPEG so the uploaded blob — and the `imeta`
 * `m`/`dim` tags built from it — describe a universally renderable image.
 * Already-web-safe images and videos pass through untouched.
 */
import { ImageManipulator, SaveFormat, type ImageResult } from 'expo-image-manipulator';
import { ResultAsync, okAsync } from 'neverthrow';

import { nostrLog } from '@/shared/lib/logger';
import type { PickedAsset } from '@/shared/lib/nostr/media/mediaUpload';

export type NormalizeImageError = { type: 'convert-failed' };

/** JPEG quality for transcoded photos (0–1); high enough to avoid visible artifacts. */
const JPEG_COMPRESS = 0.9;

const HEIC_MIME = /^image\/hei[cf](-sequence)?$/i;
const HEIC_EXT = /\.hei[cf](\?.*)?$/i;

/** True when the asset is an HEIC/HEIF image needing transcode to JPEG. */
function needsTranscode(asset: PickedAsset): boolean {
  return HEIC_MIME.test(asset.mimeType) || HEIC_EXT.test(asset.uri);
}

async function transcodeToJpeg(uri: string): Promise<ImageResult> {
  const rendered = await ImageManipulator.manipulate(uri).renderAsync();
  return rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_COMPRESS });
}

/**
 * Returns a web-safe variant of `asset`: HEIC/HEIF images are transcoded to
 * JPEG (with updated uri/mimeType/dimensions); everything else is unchanged.
 */
export function normalizeImageAsset(
  asset: PickedAsset
): ResultAsync<PickedAsset, NormalizeImageError> {
  if (!needsTranscode(asset)) return okAsync(asset);

  return ResultAsync.fromPromise(transcodeToJpeg(asset.uri), () => {
    nostrLog.warn('nostr.media.normalize_failed', { from: asset.mimeType });
    return { type: 'convert-failed' as const };
  }).map((result) => {
    nostrLog.info('nostr.media.normalized', {
      from: asset.mimeType,
      to: 'image/jpeg',
      w: result.width,
      h: result.height,
    });
    return {
      uri: result.uri,
      mimeType: 'image/jpeg',
      width: result.width,
      height: result.height,
    };
  });
}
