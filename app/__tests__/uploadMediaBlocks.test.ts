/**
 * @jest-environment node
 *
 * Pins the shared upload-then-publish media step (composer + thread reply bar).
 *
 * These assertions are written to FAIL if the orphan protocol is removed, not
 * merely to describe it: the failure case puts a sibling genuinely in flight
 * when another block fails, so dropping `await Promise.allSettled(tasks)`
 * leaves its descriptor unrecorded and the blob undeletable. An earlier
 * version of this suite used two already-resolved mocks and so stayed green
 * with the abort-siblings and `allSettled` steps deleted — it covered only
 * the report-and-rethrow half (deslop pass-28 adversary finding).
 */
import { ResultAsync, errAsync, okAsync } from 'neverthrow';

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

/** An upload that is still in flight across the caller's next microtasks. */
const inFlightOk = (value: MediaDescriptor, ms = 5) =>
  ResultAsync.fromSafePromise<MediaDescriptor, never>(
    new Promise((resolve) => setTimeout(() => resolve(value), ms))
  );

const block = (
  id: string,
  extra: { descriptor?: MediaDescriptor; localUri?: string } = {}
): {
  id: string;
  localUri?: string;
  mimeType: string;
  width: number;
  height: number;
  descriptor?: MediaDescriptor;
} => ({
  id,
  localUri: `file:///${id}.jpg`,
  mimeType: 'image/jpeg',
  // Dimensions must reach the uploader: they become the descriptor's imeta
  // `dim`, and a note published without it shifts layout as images load.
  width: 800,
  height: 600,
  ...extra,
});

/** The AbortSignal the helper actually handed to `uploadMedia` for call N. */
const signalOfCall = (n: number): AbortSignal | undefined => uploadMedia.mock.calls[n]?.[0]?.signal;

afterEach(() => jest.clearAllMocks());

describe('uploadMediaBlocks', () => {
  it('uploads pending blocks, patches descriptors, passes through resolved ones', async () => {
    uploadMedia.mockReturnValueOnce(okAsync(descriptor(1)));
    const patches: [string, object][] = [];
    const done = block('done', { descriptor: descriptor(9), localUri: undefined });
    const uploads = new Map<string, AbortController>();
    // Captured while the upload is registered, to pin that the controller the
    // CALLER can reach is the one whose signal reaches uploadMedia.
    let registered: AbortController | undefined;

    const result = await uploadMediaBlocks({
      ndk: NDK,
      blocks: [block('a'), done],
      uploads,
      patchBlock: (id, patch) => {
        if ((patch as { uploadProgress?: number }).uploadProgress === 0) {
          registered = uploads.get(id);
        }
        patches.push([id, patch]);
      },
      onOrphans: () => {
        throw new Error('no orphans on success');
      },
    });

    expect(uploadMedia).toHaveBeenCalledTimes(1); // resolved block never re-uploads
    // The asset AND the abort signal must reach uploadMedia — dropping
    // `signal: controller.signal` would disarm every cancel path (block
    // removal, unmount) while leaving the batch green.
    expect(uploadMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        asset: expect.objectContaining({
          uri: 'file:///a.jpg',
          mimeType: 'image/jpeg',
          width: 800,
          height: 600,
        }),
        signal: expect.any(AbortSignal),
      })
    );
    expect(registered).toBeDefined();
    expect(signalOfCall(0)).toBe(registered!.signal);

    expect(result[0]!.descriptor).toEqual(descriptor(1));
    expect(result[1]).toBe(done);
    expect(patches).toEqual([
      ['a', { uploadProgress: 0 }],
      ['a', { descriptor: descriptor(1), uploadProgress: undefined }],
    ]);
    expect(uploads.size).toBe(0); // controller deregistered after landing
  });

  it('on failure: waits for the in-flight sibling to land, reports its blob, aborts it, rethrows', async () => {
    // The race the protocol exists for: b fails while a is STILL UPLOADING.
    // Without `await Promise.allSettled(tasks)` a's descriptor is not yet in
    // the array when orphans are extracted, and its blob leaks undeletable.
    uploadMedia
      .mockReturnValueOnce(inFlightOk(descriptor(1)))
      .mockReturnValueOnce(errAsync({ type: 'upload-failed' }));
    const uploads = new Map<string, AbortController>();
    const orphans: { url: string }[] = [];

    await expect(
      uploadMediaBlocks({
        ndk: NDK,
        blocks: [block('a'), block('b')],
        uploads,
        patchBlock: () => {},
        onOrphans: (o) => orphans.push(...o),
      })
    ).rejects.toEqual({ type: 'upload-failed' });

    // Fails if allSettled is removed (orphans would be empty).
    expect(orphans.map((o) => o.url)).toEqual([descriptor(1).url]);
    // Fails if the abort sweep is removed: the surviving sibling must be
    // signalled, not merely forgotten.
    expect(signalOfCall(0)?.aborted).toBe(true);
    // NOTE: deliberately no `uploads.size` assertion here. Under these mocks
    // every task reaches `uploads.delete(block.id)` before its own error
    // check, so the map is empty by orphan time whether or not the helper's
    // `uploads.clear()` runs — the check would pass under its own mutation.
    // (`uploads.clear()` is load-bearing only when a task throws BEFORE that
    // delete — i.e. `uploadMedia`'s promise rejects instead of yielding an
    // Err — which costs a stale controller and one redundant abort, nothing
    // more.) The abort assertion above is what actually constrains the sweep.
  });

  it('wires upload progress through, and signals completion for uploaded blocks only', async () => {
    // The composer's N-of-M post progress counts uploads, not blocks, so a
    // pass-through block must not advance it. (This pins "not for
    // pass-throughs"; it does not pin per-block vs per-batch timing — a
    // batched variant would only make the progress bar jump.)
    uploadMedia.mockImplementationOnce((params) => {
      params.onProgress?.(0.5);
      return okAsync(descriptor(1));
    });
    const patches: [string, object][] = [];
    const completed: string[] = [];

    await uploadMediaBlocks({
      ndk: NDK,
      blocks: [
        block('a'),
        // Already uploaded but its local file is still around — the reply bar
        // passes its blocks UNFILTERED, so after a failed publish a retry must
        // not re-upload this one (that would orphan the first blob).
        block('retried', { descriptor: descriptor(9) }),
        block('picked', { localUri: undefined }),
      ],
      uploads: new Map(),
      patchBlock: (id, patch) => patches.push([id, patch]),
      onBlockUploaded: (b) => completed.push(b.id),
      onOrphans: () => {},
    });

    expect(patches).toContainEqual(['a', { uploadProgress: 0.5 }]);
    expect(completed).toEqual(['a']);
    expect(uploadMedia).toHaveBeenCalledTimes(1);
  });

  it('reports nothing when the very first upload fails (no blob ever landed)', async () => {
    uploadMedia.mockReturnValueOnce(errAsync({ type: 'upload-failed' }));
    const onOrphans = jest.fn();

    await expect(
      uploadMediaBlocks({
        ndk: NDK,
        blocks: [block('a')],
        uploads: new Map(),
        patchBlock: () => {},
        onOrphans,
      })
    ).rejects.toEqual({ type: 'upload-failed' });

    expect(onOrphans).not.toHaveBeenCalled();
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
