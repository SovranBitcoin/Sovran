/**
 * Blossom BUD-11 delete: signs a fresh `t=delete` auth per blob and sends
 * `DELETE /<sha256>` with `Authorization` + `X-SHA-256`. A 403/404 (not owner /
 * already gone) is surfaced non-fatally; an aborted signal short-circuits before
 * any request. Auth, NDK event, logger, and `fetch` are mocked.
 */
/* eslint-disable import/first */

jest.mock('@/shared/lib/nostr/media/blossomAuth', () => {
  const buildBlossomAuthEvent = jest.fn(() => ({
    kind: 24242,
    content: '',
    created_at: 0,
    tags: [],
  }));
  return {
    __esModule: true,
    buildBlossomAuthEvent,
    encodeAuthHeader: () => 'Nostr xxx',
    sha256Hex: () => 'deadbeef',
    __mocks: { buildBlossomAuthEvent },
  };
});

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

import { deleteFromBlossom } from '@/shared/lib/nostr/media/blossomClient';

const { buildBlossomAuthEvent } = (
  jest.requireMock('@/shared/lib/nostr/media/blossomAuth') as {
    __mocks: { buildBlossomAuthEvent: jest.Mock };
  }
).__mocks;

const ndkStub: NDK = Object.create(null);
const SHA = 'a'.repeat(64);
const mockFetch = jest.fn();

beforeEach(() => {
  buildBlossomAuthEvent.mockClear();
  mockFetch.mockReset().mockResolvedValue({ status: 200 });
  // eslint-disable-next-line no-restricted-properties -- test stub for the BUD-11 DELETE fetch
  global.fetch = mockFetch as unknown as typeof fetch;
});

const baseOpts = () => ({ ndk: ndkStub, server: 'https://blossom.example', sha256: SHA });

describe('deleteFromBlossom', () => {
  it('signs a delete auth and DELETEs /<sha256> with the right headers', async () => {
    const result = await deleteFromBlossom(baseOpts());

    expect(result.isOk()).toBe(true);
    expect(buildBlossomAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', sha256: SHA })
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`https://blossom.example/${SHA}`);
    expect(init.method).toBe('DELETE');
    expect(init.headers).toMatchObject({ Authorization: 'Nostr xxx', 'X-SHA-256': SHA });
  });

  it('surfaces a 403 (not owner) non-fatally', async () => {
    mockFetch.mockResolvedValueOnce({ status: 403 });
    const result = await deleteFromBlossom(baseOpts());

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({ type: 'delete-failed', status: 403 });
  });

  it('treats a network throw as delete-failed', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'));
    const result = await deleteFromBlossom(baseOpts());

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({ type: 'delete-failed' });
  });

  it('short-circuits an already-aborted signal without fetching', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await deleteFromBlossom({ ...baseOpts(), signal: controller.signal });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({ type: 'canceled' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
