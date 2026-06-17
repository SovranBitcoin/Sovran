/**
 * @fileoverview High-level media upload: a picked asset → a `MediaDescriptor`.
 *
 * Composes the configured Blossom server, the upload client, and the asset's
 * own dimensions/alt into the descriptor the composer serializes into kind:1
 * content + an `imeta` tag.
 */
import type NDK from '@nostr-dev-kit/ndk-mobile';
import type { ResultAsync } from 'neverthrow';

import { uploadToBlossom, type BlossomError } from '@/shared/lib/nostr/media/blossomClient';
import { getMediaServer } from '@/shared/lib/nostr/media/mediaServerStore';
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
}

/** Uploads a picked asset and returns a ready-to-serialize media descriptor. */
export function uploadMedia(opts: UploadMediaOptions): ResultAsync<MediaDescriptor, BlossomError> {
  return uploadToBlossom({
    ndk: opts.ndk,
    server: opts.server ?? getMediaServer(),
    fileUri: opts.asset.uri,
    mimeType: opts.asset.mimeType,
  }).map((descriptor) => ({
    url: descriptor.url,
    sha256: descriptor.sha256,
    mimeType: opts.asset.mimeType,
    sizeBytes: descriptor.size,
    width: opts.asset.width,
    height: opts.asset.height,
    alt: opts.alt,
    sensitive: opts.sensitive,
  }));
}
