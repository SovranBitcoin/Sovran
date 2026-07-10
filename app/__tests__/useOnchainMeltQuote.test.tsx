/**
 * @jest-environment node
 */

import { act, renderHook } from '@testing-library/react-native';

import { useManagerContext } from '@cashu/coco-react';

import { useOnchainMeltQuote } from '@/shared/hooks/useOnchainMeltQuote';

jest.mock('@cashu/coco-react', () => ({
  useManagerContext: jest.fn(),
}));

const mockedUseManagerContext = jest.mocked(useManagerContext);

const MINT_URL = 'https://mint.example';
const QUOTE_ID = 'quote-a';
const POLL_MS = 12_000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });

  return { promise, reject, resolve };
}

function installRefresh(refresh: jest.Mock): void {
  mockedUseManagerContext.mockReturnValue(
    Object.assign(Object.create(null), {
      manager: {
        quotes: {
          melt: { refresh },
        },
      },
    })
  );
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useOnchainMeltQuote', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('refreshes immediately and then at the exact twelve-second cadence', async () => {
    const refresh = jest.fn().mockResolvedValue({ state: 'PENDING' });
    installRefresh(refresh);

    const { result, unmount } = renderHook(() => useOnchainMeltQuote(MINT_URL, QUOTE_ID));
    await flushEffects();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenLastCalledWith({ mintUrl: MINT_URL, quoteId: QUOTE_ID });
    expect(result.current.state).toBe('PENDING');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS - 1);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(refresh).toHaveBeenCalledTimes(2);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(refresh).toHaveBeenCalledTimes(3);

    unmount();
  });

  it('stops every future poll once a PAID quote includes its outpoint', async () => {
    const refresh = jest.fn().mockResolvedValue({
      outpoint: `${'a'.repeat(64)}:0`,
      state: 'PAID',
    });
    installRefresh(refresh);

    const { result, unmount } = renderHook(() => useOnchainMeltQuote(MINT_URL, QUOTE_ID));
    await flushEffects();

    expect(result.current.state).toBe('PAID');
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS * 5);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('retains the last quote after a rejection and continues polling', async () => {
    const refresh = jest
      .fn()
      .mockResolvedValueOnce({ state: 'PENDING' })
      .mockRejectedValueOnce(new Error('mint offline'))
      .mockResolvedValueOnce({ state: 'UNPAID' });
    installRefresh(refresh);

    const { result, unmount } = renderHook(() => useOnchainMeltQuote(MINT_URL, QUOTE_ID));
    await flushEffects();
    expect(result.current.state).toBe('PENDING');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe('PENDING');
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(result.current.state).toBe('UNPAID');

    unmount();
  });

  it('ignores a late quote A result after the hook switches to quote B', async () => {
    const quoteA = deferred<Record<string, unknown>>();
    const quoteB = deferred<Record<string, unknown>>();
    const refresh = jest.fn(({ quoteId }: { quoteId: string }) =>
      quoteId === 'quote-a' ? quoteA.promise : quoteB.promise
    );
    installRefresh(refresh);

    const { rerender, result, unmount } = renderHook(
      ({ quoteId }: { quoteId: string }) => useOnchainMeltQuote(MINT_URL, quoteId),
      { initialProps: { quoteId: 'quote-a' } }
    );
    expect(refresh).toHaveBeenCalledWith({ mintUrl: MINT_URL, quoteId: 'quote-a' });

    rerender({ quoteId: 'quote-b' });
    expect(refresh).toHaveBeenCalledWith({ mintUrl: MINT_URL, quoteId: 'quote-b' });

    quoteA.resolve({ state: 'PAID' });
    await flushEffects();
    expect(result.current.state).toBeNull();

    quoteB.resolve({ state: 'PENDING' });
    await flushEffects();
    expect(result.current.state).toBe('PENDING');

    unmount();
  });

  it.each([
    { mintUrl: null, quoteId: QUOTE_ID },
    { mintUrl: MINT_URL, quoteId: null },
  ])('clears state and schedules nothing for falsy arguments: %p', async (nextArgs) => {
    const refresh = jest.fn().mockResolvedValue({ state: 'PENDING' });
    installRefresh(refresh);

    const { rerender, result, unmount } = renderHook(
      ({ mintUrl, quoteId }: { mintUrl: string | null; quoteId: string | null }) =>
        useOnchainMeltQuote(mintUrl, quoteId),
      { initialProps: { mintUrl: MINT_URL, quoteId: QUOTE_ID } }
    );
    await flushEffects();
    expect(result.current.state).toBe('PENDING');

    rerender(nextArgs);
    expect(result.current.state).toBeNull();
    expect(result.current.isLoading).toBe(false);

    const callsAtClear = refresh.mock.calls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS * 5);
    });
    expect(refresh).toHaveBeenCalledTimes(callsAtClear);

    unmount();
  });

  it('suppresses a late state write after unmount', async () => {
    const pending = deferred<Record<string, unknown>>();
    const refresh = jest.fn(() => pending.promise);
    installRefresh(refresh);

    const { result, unmount } = renderHook(() => useOnchainMeltQuote(MINT_URL, QUOTE_ID));
    expect(result.current.state).toBeNull();
    expect(result.current.isLoading).toBe(true);

    unmount();
    pending.resolve({ state: 'PAID' });
    await flushEffects();

    expect(result.current.state).toBeNull();
    expect(result.current.isLoading).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
