/**
 * Blossom upload resilience: size cap, transient-failure retry with backoff,
 * no-retry on 4xx, and abort/cancel. The native file-system, auth signing,
 * NDK event, and logger are mocked so the control flow can be asserted without
 * touching disk or network.
 */
/* eslint-disable import/first */

jest.mock('expo-file-system/legacy', () => {
  const getInfoAsync = jest.fn(async () => ({ exists: true, size: 1024 }));
  const readAsStringAsync = jest.fn(async () => 'AAAA');
  const createUploadTask = jest.fn();
  return {
    __esModule: true,
    getInfoAsync,
    readAsStringAsync,
    createUploadTask,
    uploadAsync: jest.fn(),
    EncodingType: { Base64: 'base64' },
    FileSystemUploadType: { BINARY_CONTENT: 1 },
    __mocks: { getInfoAsync, readAsStringAsync, createUploadTask },
  };
});

jest.mock('@/shared/lib/nostr/media/blossomAuth', () => ({
  __esModule: true,
  buildBlossomAuthEvent: () => ({ kind: 24242, content: '', created_at: 0, tags: [] }),
  encodeAuthHeader: () => 'Nostr xxx',
  sha256Hex: () => 'deadbeef',
}));

jest.mock(
  '@nostr-dev-kit/ndk-mobile',
  () => ({
    __esModule: true,
    NDKEvent: class {
      kind = 0;
      content = '';
      created_at = 0;
      tags: string[][] = [];
      async sign(): Promise<void> {}
      rawEvent(): object {
        return {};
      }
    },
  }),
  { virtual: true }
);

jest.mock('@/shared/lib/logger', () => ({
  __esModule: true,
  nostrLog: { info: jest.fn(), warn: jest.fn() },
}));

import type NDK from '@nostr-dev-kit/ndk-mobile';

import { uploadToBlossom } from '@/shared/lib/nostr/media/blossomClient';

// The client never touches the NDK beyond passing it to the (mocked) NDKEvent.
const ndkStub: NDK = Object.create(null);

const { getInfoAsync, createUploadTask } = (
  jest.requireMock('expo-file-system/legacy') as {
    __mocks: { getInfoAsync: jest.Mock; createUploadTask: jest.Mock };
  }
).__mocks;

const okBody = JSON.stringify({ url: 'https://b/abc.jpg', sha256: 'deadbeef', size: 10 });

/** Builds a createUploadTask mock whose uploadAsync returns/throws per the queue. */
function queueUploads(outcomes: { status?: number; body?: string; throw?: boolean }[]) {
  let i = 0;
  createUploadTask.mockImplementation(() => ({
    uploadAsync: async () => {
      const o = outcomes[Math.min(i, outcomes.length - 1)];
      i += 1;
      if (o.throw) throw new Error('network');
      return { status: o.status ?? 200, body: o.body ?? okBody };
    },
    cancelAsync: async () => {},
  }));
}

const baseOpts = () => ({
  ndk: ndkStub,
  server: 'https://b',
  fileUri: 'file:///x.jpg',
  mimeType: 'image/jpeg',
});

beforeEach(() => {
  getInfoAsync.mockReset().mockResolvedValue({ exists: true, size: 1024 });
  createUploadTask.mockReset();
});

describe('uploadToBlossom resilience', () => {
  it('rejects oversized files before uploading', async () => {
    getInfoAsync.mockResolvedValueOnce({ exists: true, size: 100 * 1024 * 1024 });
    const result = await uploadToBlossom(baseOpts());

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({ type: 'too-large', size: 100 * 1024 * 1024 });
    expect(createUploadTask).not.toHaveBeenCalled();
  });

  it('returns the descriptor on a first-try success', async () => {
    queueUploads([{ status: 200 }]);
    const result = await uploadToBlossom(baseOpts());

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().url).toBe('https://b/abc.jpg');
    expect(createUploadTask).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure then succeeds', async () => {
    queueUploads([{ throw: true }, { status: 200 }]);
    const result = await uploadToBlossom(baseOpts());

    expect(result.isOk()).toBe(true);
    expect(createUploadTask).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 4xx response', async () => {
    queueUploads([{ status: 400 }]);
    const result = await uploadToBlossom(baseOpts());

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({ type: 'upload-failed', status: 400 });
    expect(createUploadTask).toHaveBeenCalledTimes(1);
  });

  it('returns canceled for an already-aborted signal without uploading', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await uploadToBlossom({ ...baseOpts(), signal: controller.signal });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({ type: 'canceled' });
    expect(createUploadTask).not.toHaveBeenCalled();
  });
});
