/**
 * deleteOwnedBlob owns the durable requested -> terminal state transition and
 * the HEAD reconciliation of ambiguous Blossom DELETE failures.
 */
/* eslint-disable import/first */

jest.mock('@/shared/lib/nostr/media/blossomClient', () => {
  const deleteFromBlossom = jest.fn();
  const checkBlobExists = jest.fn();
  return {
    __esModule: true,
    deleteFromBlossom,
    checkBlobExists,
    __mock: { deleteFromBlossom, checkBlobExists },
  };
});

jest.mock('@/shared/stores/profile/ownedMediaStore', () => {
  const setDeleteState = jest.fn();
  return {
    __esModule: true,
    useOwnedMediaStore: { getState: () => ({ setDeleteState }) },
    __mock: { setDeleteState },
  };
});

import { err, ok } from 'neverthrow';

import { deleteOwnedBlob } from '@/shared/lib/nostr/media/deleteOwnedBlob';

const blossom = (
  jest.requireMock('@/shared/lib/nostr/media/blossomClient') as {
    __mock: {
      deleteFromBlossom: jest.Mock;
      checkBlobExists: jest.Mock;
    };
  }
).__mock;
const { setDeleteState } = (
  jest.requireMock('@/shared/stores/profile/ownedMediaStore') as {
    __mock: { setDeleteState: jest.Mock };
  }
).__mock;

const HOST = 'https://blossom.example';
const SHA256 = 'a'.repeat(64);
const URL = `${HOST}/${SHA256}`;
const ndk = Object.create(null) as never;

function args() {
  return { ndk, host: HOST, sha256: SHA256, url: URL };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('deleteOwnedBlob', () => {
  it('records requested -> deleted on success without a HEAD probe', async () => {
    blossom.deleteFromBlossom.mockResolvedValue(ok(undefined));

    const result = await deleteOwnedBlob(args());

    expect(result).toStrictEqual({ deleted: true, error: undefined });
    expect(setDeleteState.mock.calls).toStrictEqual([
      [HOST, SHA256, 'delete-requested'],
      [HOST, SHA256, 'deleted'],
    ]);
    expect(blossom.checkBlobExists).not.toHaveBeenCalled();
  });

  it.each([
    ['an overloaded 404', { type: 'delete-failed' as const, status: 404 }],
    ['a statusless timeout', { type: 'delete-failed' as const }],
    ['an arbitrary server failure', { type: 'delete-failed' as const, status: 503 }],
  ])('recovers %s when HEAD confirms the blob is absent', async (_label, error) => {
    blossom.deleteFromBlossom.mockResolvedValue(err(error));
    blossom.checkBlobExists.mockResolvedValue(false);

    const result = await deleteOwnedBlob(args());

    expect(result).toStrictEqual({ deleted: true, error: undefined });
    expect(blossom.checkBlobExists).toHaveBeenCalledTimes(1);
    expect(blossom.checkBlobExists).toHaveBeenCalledWith(URL);
    expect(setDeleteState.mock.calls).toStrictEqual([
      [HOST, SHA256, 'delete-requested'],
      [HOST, SHA256, 'deleted'],
    ]);
  });

  it.each([
    ['still present', true],
    ['indeterminate', null],
  ])('keeps a failed delete failed when HEAD is %s', async (_label, exists) => {
    blossom.deleteFromBlossom.mockResolvedValue(
      err({ type: 'delete-failed' as const, status: 403 })
    );
    blossom.checkBlobExists.mockResolvedValue(exists);

    const result = await deleteOwnedBlob(args());

    expect(result).toStrictEqual({ deleted: false, error: 'delete-failed' });
    expect(blossom.checkBlobExists).toHaveBeenCalledTimes(1);
    expect(blossom.checkBlobExists).toHaveBeenCalledWith(URL);
    expect(setDeleteState.mock.calls).toStrictEqual([
      [HOST, SHA256, 'delete-requested'],
      [HOST, SHA256, 'delete-failed'],
    ]);
  });

  it('does not HEAD-probe a signing failure', async () => {
    blossom.deleteFromBlossom.mockResolvedValue(err({ type: 'sign-failed' as const }));

    const result = await deleteOwnedBlob(args());

    expect(result).toStrictEqual({ deleted: false, error: 'sign-failed' });
    expect(blossom.checkBlobExists).not.toHaveBeenCalled();
    expect(setDeleteState.mock.calls).toStrictEqual([
      [HOST, SHA256, 'delete-requested'],
      [HOST, SHA256, 'delete-failed'],
    ]);
  });
});
