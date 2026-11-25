/**
 * @jest-environment node
 *
 * Read ordering of `useMintKeysetUnits`: the units each trusted mint holds
 * keysets for decide which units the wallet offers, so an older read that
 * finishes late must not replace a newer answer.
 */

import { act, renderHook } from '@testing-library/react-native';

import {
  hasSettledKeysetRead,
  useMintKeysetUnits,
} from '@/features/wallet/hooks/useMintKeysetUnits';

const MINT = 'https://mint.example';
const MINT_B = 'https://mint-b.example';

type Handler = () => void;
const mockHandlers = new Map<string, Set<Handler>>();
const mockManager = {
  on: (event: string, handler: Handler) => {
    const set = mockHandlers.get(event) ?? new Set<Handler>();
    set.add(handler);
    mockHandlers.set(event, set);
    return () => set.delete(handler);
  },
};
let mockTrustedMints = [{ mintUrl: MINT }];
const mockGetMintKeysetUnits = jest.fn<Promise<string[]>, [unknown, string]>();

jest.mock('@cashu/coco-react', () => ({
  useManager: () => mockManager,
  useMints: () => ({ trustedMints: mockTrustedMints }),
}));
jest.mock('@/shared/lib/cashu/managerInternals', () => ({
  getMintKeysetUnits: (manager: unknown, mintUrl: string) =>
    mockGetMintKeysetUnits(manager, mintUrl),
}));
jest.mock('@/shared/lib/cashu/recoverySuppression', () => ({
  deferWhileRecovering: () => false,
}));
jest.mock('@/shared/lib/logger', () => ({
  walletLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mockTrustedMints = [{ mintUrl: MINT }];
  mockHandlers.clear();
  mockGetMintKeysetUnits.mockReset();
});

test('an older keyset read that finishes last does not replace the newer units', async () => {
  const first = deferred<string[]>();
  const second = deferred<string[]>();
  mockGetMintKeysetUnits
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise);

  const { result, unmount } = renderHook(() => useMintKeysetUnits());
  expect(mockGetMintKeysetUnits).toHaveBeenCalledTimes(1);

  // Coco refreshes the mint while the first read is still running.
  await act(async () => mockHandlers.get('mint:updated')?.forEach((handler) => handler()));
  expect(mockGetMintKeysetUnits).toHaveBeenCalledTimes(2);

  await act(async () => second.resolve(['sat', 'usd']));
  expect(result.current).toEqual({ [MINT]: ['sat', 'usd'] });

  await act(async () => first.resolve(['sat']));
  expect(result.current).toEqual({ [MINT]: ['sat', 'usd'] });
  unmount();
});

test('reads that finish in order publish each answer', async () => {
  const first = deferred<string[]>();
  const second = deferred<string[]>();
  mockGetMintKeysetUnits
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise);

  const { result, unmount } = renderHook(() => useMintKeysetUnits());
  await act(async () => first.resolve(['sat']));
  expect(result.current).toEqual({ [MINT]: ['sat'] });

  await act(async () => mockHandlers.get('mint:updated')?.forEach((handler) => handler()));
  await act(async () => second.resolve(['sat', 'usd']));
  expect(result.current).toEqual({ [MINT]: ['sat', 'usd'] });
  unmount();
});

test('replacing a failed-read mint with another failed-read mint settles the replacement key', async () => {
  mockGetMintKeysetUnits.mockRejectedValue(new Error('db read failed'));

  const { result, rerender, unmount } = renderHook(() => useMintKeysetUnits());
  await act(async () => {
    await Promise.resolve();
  });
  expect(hasSettledKeysetRead(result.current, MINT)).toBe(true);

  mockTrustedMints = [{ mintUrl: MINT_B }];
  await act(async () => {
    rerender({});
    await Promise.resolve();
  });
  expect(hasSettledKeysetRead(result.current, MINT_B)).toBe(true);
  expect(hasSettledKeysetRead(result.current, MINT)).toBe(false);
  unmount();
});
