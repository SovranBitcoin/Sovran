/**
 * @jest-environment node
 *
 * Pins the shared upload-then-publish media step (composer + thread reply bar):
 * descriptor pass-through, patch flow on success, and the orphan protocol on
 * failure (abort siblings → allSettled → report landed blobs → rethrow).
 */
import { errAsync, okAsync } from 'neverthrow';

import { uploadMedia as uploadMediaImpl } from '@/shared/lib/nostr/media/mediaUpload';
import { uploadMediaBlocks } from '@/shared/lib/nostr/media/uploadMediaBlocks';
import type { MediaDescriptor } from '@/shared/lib/nostr/media/types';

jest.mock('@/shared/lib/nostr/media/mediaUpload', () => ({
  uploadMedia: jest.fn(),
}));

const uploadMedia = jest.mocked(uploadMediaImpl);

const NDK = undefined as never;
const descriptor = (n: number): MediaDescriptor => ({
  url: `https://blossom.example/${n}`,
  sha256: `${n}`.repeat(64).slice(0, 64),
  mimeType: 'image/jpeg',
});

const block = (
  id: string,
  extra: { descriptor?: MediaDescriptor; localUri?: string } = {}
): { id: string; localUri?: string; mimeType: string; descriptor?: MediaDescriptor } => ({
  id,
  localUri: `file:///${id}.jpg`,
  mimeType: 'image/jpeg',
  ...extra,
});

afterEach(() => jest.clearAllMocks());

describe('uploadMediaBlocks', () => {
  it('uploads pending blocks, patches descriptors, passes through resolved ones', async () => {
    uploadMedia.mockReturnValueOnce(okAsync(descriptor(1)));
    const patches: [string, object][] = [];
    const done = block('done', { descriptor: descriptor(9), localUri: undefined });
    const uploads = new Map<string, AbortController>();

    const result = await uploadMediaBlocks({
      ndk: NDK,
      blocks: [block('a'), done],
      uploads,
      patchBlock: (id, patch) => patches.push([id, patch]),
      onOrphans: () => {
        throw new Error('no orphans on success');
      },
    });

    expect(uploadMedia).toHaveBeenCalledTimes(1); // resolved block never re-uploads
    expect(result[0]!.descriptor).toEqual(descriptor(1));
    expect(result[1]).toBe(done);
    expect(patches).toEqual([
      ['a', { uploadProgress: 0 }],
      ['a', { descriptor: descriptor(1), uploadProgress: undefined }],
    ]);
    expect(uploads.size).toBe(0); // controller deregistered after landing
  });

  it('on failure: aborts siblings, settles, reports landed blobs as orphans, rethrows', async () => {
    // Block a lands; block b fails — a's blob must be reported deletable.
    uploadMedia
      .mockReturnValueOnce(okAsync(descriptor(1)))
      .mockReturnValueOnce(errAsync({ type: 'upload-failed' }));
    const uploads = new Map<string, AbortController>();
    const orphans: unknown[] = [];

    await expect(
      uploadMediaBlocks({
        ndk: NDK,
        blocks: [block('a'), block('b')],
        uploads,
        patchBlock: () => {},
        onOrphans: (o) => orphans.push(...o),
      })
    ).rejects.toEqual({ type: 'upload-failed' });

    expect(orphans).toHaveLength(1);
    expect((orphans[0] as { url: string }).url).toBe(descriptor(1).url);
    expect(uploads.size).toBe(0); // all controllers aborted + cleared
  });

  it('a canceled upload keeps its progress patch silent and still runs the orphan protocol', async () => {
    uploadMedia.mockReturnValueOnce(errAsync({ type: 'canceled' }));
    const patches: [string, object][] = [];

    await expect(
      uploadMediaBlocks({
        ndk: NDK,
        blocks: [block('a')],
        uploads: new Map(),
        patchBlock: (id, patch) => patches.push([id, patch]),
        onOrphans: () => {},
      })
    ).rejects.toEqual({ type: 'canceled' });

    // canceled ⇒ no uploadProgress-reset patch (the block is being removed)
    expect(patches).toEqual([['a', { uploadProgress: 0 }]]);
  });
});
