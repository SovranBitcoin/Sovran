import type NDK from '@nostr-dev-kit/ndk-mobile';

import { uploadMedia } from '@/shared/lib/nostr/media/mediaUpload';
import { extractOwnedBlobsFromDescriptors } from '@/shared/lib/nostr/media/ownedBlobs';
import type { OwnedBlob } from '@/shared/lib/nostr/media/ownedBlobs';
import type { MediaDescriptor } from '@/shared/lib/nostr/media/types';

/**
 * The structural shape a composing surface's media block must have to ride
 * this uploader. Both composer's `ComposerBlock` media variant and the reply
 * bar's local block satisfy it structurally — deliberately NOT imported from
 * a feature (shared code never depends on feature types), and deliberately not
 * exported: callers pass their own structurally-compatible block types.
 */
interface UploadableMediaBlock {
  id: string;
  localUri?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  descriptor?: MediaDescriptor;
  uploadProgress?: number;
}

/**
 * Upload-then-publish media step shared by every composing surface (post
 * composer, thread reply bar). Owns the invariants both sites were carrying
 * as copies:
 *  - per-block AbortControllers registered in the CALLER-owned `uploads` map
 *    (so removing a block / unmounting can cancel from outside);
 *  - on any failure: abort the surviving siblings, then `Promise.allSettled`
 *    BEFORE reporting orphans — a sibling that finished around the failure
 *    boundary must land its descriptor first, so every uploaded blob stays
 *    deletable from "My media";
 *  - blocks that already carry a descriptor (or have no local file) pass
 *    through untouched.
 *
 * Pure of stores: orphans are handed to `onOrphans` (callers write them to
 * ownedMediaStore). Progress lands via `patchBlock`; `onBlockUploaded` feeds
 * the composer's N-of-M post progress. Throws the first upload error after
 * the orphan protocol has run.
 */
export async function uploadMediaBlocks<B extends UploadableMediaBlock>(params: {
  ndk: NDK;
  blocks: readonly B[];
  uploads: Map<string, AbortController>;
  patchBlock: (id: string, patch: Partial<UploadableMediaBlock>) => void;
  onBlockUploaded?: (block: B) => void;
  onOrphans: (orphans: OwnedBlob[]) => void;
}): Promise<B[]> {
  const { ndk, blocks, uploads, patchBlock, onBlockUploaded, onOrphans } = params;
  // Descriptors that uploaded before any sibling failed — reported as orphans
  // if the batch aborts.
  const uploadedDescriptors: MediaDescriptor[] = [];

  const tasks = blocks.map(async (block): Promise<B> => {
    if (block.descriptor || !block.localUri) return block;
    const controller = new AbortController();
    uploads.set(block.id, controller);
    patchBlock(block.id, { uploadProgress: 0 });
    const upload = await uploadMedia({
      ndk,
      asset: {
        uri: block.localUri,
        mimeType: block.mimeType ?? 'image/jpeg',
        width: block.width,
        height: block.height,
      },
      signal: controller.signal,
      onProgress: (fraction) => patchBlock(block.id, { uploadProgress: fraction }),
    });
    uploads.delete(block.id);
    if (upload.isErr()) {
      if (upload.error.type !== 'canceled') {
        patchBlock(block.id, { uploadProgress: undefined });
      }
      throw upload.error;
    }
    uploadedDescriptors.push(upload.value);
    const next = { ...block, descriptor: upload.value, uploadProgress: undefined };
    patchBlock(block.id, { descriptor: upload.value, uploadProgress: undefined });
    onBlockUploaded?.(next);
    return next;
  });

  try {
    return await Promise.all(tasks);
  } catch (error) {
    uploads.forEach((controller) => controller.abort());
    uploads.clear();
    await Promise.allSettled(tasks);
    const orphans = extractOwnedBlobsFromDescriptors(uploadedDescriptors);
    if (orphans.length > 0) onOrphans(orphans);
    throw error;
  }
}
