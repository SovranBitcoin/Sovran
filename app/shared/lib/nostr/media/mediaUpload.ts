/**
 * @fileoverview High-level media upload: a picked asset → a `MediaDescriptor`.
 *
 * Composes the configured Blossom server, the upload client, and the asset's
 * own dimensions/alt into the descriptor the composer serializes into kind:1
 * content + an `imeta` tag.
 */
import * as FileSystem from 'expo-file-system/legacy';
import type NDK from '@nostr-dev-kit/ndk-mobile';
import { ResultAsync, errAsync, okAsync } from 'neverthrow';

import { nostrLog } from '@/shared/lib/logger';
import {
  MAX_UPLOAD_BYTES,
  uploadToBlossom,
  type BlossomError,
} from '@/shared/lib/nostr/media/blossomClient';
import { getMediaServer } from '@/shared/lib/nostr/media/mediaServerStore';
import {
  normalizeImageAsset,
  type NormalizeImageError,
} from '@/shared/lib/nostr/media/normalizeImage';
import type { MediaDescriptor } from '@/shared/lib/nostr/media/types';

export interface PickedAsset {
  uri: string;
  mimeType: string;
  width?: number;
  height?: number;
}

export interface UploadMediaOptions {
  ndk: NDK;
  asset: PickedAsset;
  alt?: string;
  sensitive?: boolean;
  /** Override the configured server (e.g. for a one-off). */
  server?: string;
  /** Receives upload progress as a 0–1 fraction. */
  onProgress?: (fraction: number) => void;
  /** Aborts the in-flight upload (e.g. when the media block is removed). */
  signal?: AbortSignal;
}

/**
 * Pathological-input guard: refuse to decode an absurdly large original before
 * `normalizeImageAsset` reads it into the native pipeline (where it could spike
 * memory). This is intentionally generous (2× the upload cap) — a large but
 * compressible HEIC still re-encodes down and is caught by the real
 * `MAX_UPLOAD_BYTES` cap on the encoded output inside `uploadToBlossom`.
 */
const PREFLIGHT_MAX_BYTES = 2 * MAX_UPLOAD_BYTES;

function preflightOriginalSize(asset: PickedAsset): ResultAsync<PickedAsset, BlossomError> {
  return ResultAsync.fromPromise(FileSystem.getInfoAsync(asset.uri), () => ({
    type: 'read-failed' as const,
  })).andThen((info) => {
    if (!info.exists || typeof info.size !== 'number') {
      nostrLog.warn('nostr.media.read_failed');
      return errAsync({ type: 'read-failed' as const });
    }
    if (info.size > PREFLIGHT_MAX_BYTES) {
      nostrLog.warn('nostr.media.too_large', { size: info.size });
      return errAsync({ type: 'too-large' as const, size: info.size });
    }
    return okAsync(asset);
  });
}

/**
 * Uploads a picked asset and returns a ready-to-serialize media descriptor.
 *
 * Images are normalized to a web-safe format first (HEIC/HEIF → JPEG) so the
 * uploaded blob and its `imeta` tag render in every client.
 */
export function uploadMedia(
  opts: UploadMediaOptions
): ResultAsync<MediaDescriptor, BlossomError | NormalizeImageError> {
  return preflightOriginalSize(opts.asset)
    .andThen(() => normalizeImageAsset(opts.asset))
    .andThen((asset) =>
      uploadToBlossom({
        ndk: opts.ndk,
        server: opts.server ?? getMediaServer(),
        fileUri: asset.uri,
        mimeType: asset.mimeType,
        onProgress: opts.onProgress,
        signal: opts.signal,
      }).map((descriptor) => ({
        url: descriptor.url,
        sha256: descriptor.sha256,
        mimeType: asset.mimeType,
        sizeBytes: descriptor.size,
        width: asset.width,
        height: asset.height,
        alt: opts.alt,
        sensitive: opts.sensitive,
      }))
    );
}
