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
import { ensureUrlExtension, resolveMediaType } from '@/shared/lib/nostr/media/mediaType';
import { getMediaServer } from '@/shared/lib/nostr/media/mediaServerStore';
import type { MediaDescriptor } from '@/shared/lib/nostr/media/types';

export interface PickedAsset {
  uri: string;
  /** Picker-supplied mime; may be absent or wrong — resolved against the name. */
  mimeType?: string;
  /** The asset's own file name, the most trustworthy type signal. */
  fileName?: string;
  /** Media family, the last-resort hint when name/uri/mime resolve nothing. */
  kind?: 'image' | 'video';
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
  const { mimeType, extension } = resolveMediaType({
    fileName: opts.asset.fileName,
    uri: opts.asset.uri,
    mimeType: opts.asset.mimeType,
    kind: opts.asset.kind,
  });
  return uploadToBlossom({
    ndk: opts.ndk,
    server: opts.server ?? getMediaServer(),
    fileUri: opts.asset.uri,
    mimeType,
  }).map((descriptor) => ({
    // Guarantee a renderable suffix; Blossom may return a bare-hash URL.
    url: ensureUrlExtension(descriptor.url, extension),
    sha256: descriptor.sha256,
    mimeType,
    sizeBytes: descriptor.size,
    width: opts.asset.width,
    height: opts.asset.height,
    alt: opts.alt,
    sensitive: opts.sensitive,
  }));
}
