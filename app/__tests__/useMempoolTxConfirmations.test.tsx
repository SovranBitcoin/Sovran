/**
 * @jest-environment node
 */

import { useLayoutEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

import { defaultChainAdapter, type ChainTransactionStatus } from 'wallet';

import { useMempoolTxConfirmations } from '@/shared/hooks/useMempoolTxConfirmations';

let mockFocused = true;
let appStateChanged: (state: AppStateStatus) => void;
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    ReactActual.useEffect(() => (mockFocused ? effect() : undefined), [effect, mockFocused]);
  },
}));

const POLL_MS = 30_000;

function txStatus(txid: string, confirmed: boolean, confirmations: number): ChainTransactionStatus {
  return { confirmed, confirmations, txid };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });

  return { promise, reject, resolve };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useMempoolTxConfirmations', () => {
  it('does not overlap a slow request with subsequent polling ticks', async () => {
    const pending = deferred<ChainTransactionStatus | null>();
    const getStatus = jest
      .spyOn(defaultChainAdapter, 'getTransactionStatus')
      .mockReturnValue(pending.promise);
    const { unmount } = renderHook(() => useMempoolTxConfirmations('abc'));
    await act(async () => jest.advanceTimersByTimeAsync(POLL_MS * 3));
    expect(getStatus).toHaveBeenCalledTimes(1);
    unmount();
    pending.resolve(null);
    await flushEffects();
  });

  it('stops polling while backgrounded or blurred and refreshes on return', async () => {
    const getStatus = jest
      .spyOn(defaultChainAdapter, 'getTransactionStatus')
      .mockResolvedValue(txStatus('abc', false, 0));
    const { result, rerender, unmount } = renderHook(() => useMempoolTxConfirmations('abc'));
    await flushEffects();
    act(() => appStateChanged('background'));
    await act(async () => jest.advanceTimersByTimeAsync(POLL_MS * 3));
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(result.current.status?.txid).toBe('abc');
    act(() => appStateChanged('active'));
    await flushEffects();
    expect(getStatus).toHaveBeenCalledTimes(2);
    mockFocused = false;
    rerender({});
    await act(async () => jest.advanceTimersByTimeAsync(POLL_MS * 2));
    expect(getStatus).toHaveBeenCalledTimes(2);
    mockFocused = true;
    rerender({});
    await flushEffects();
    expect(getStatus).toHaveBeenCalledTimes(3);
    unmount();
  });

  it('does not commit the previous transaction status on a txid change', async () => {
    jest
      .spyOn(defaultChainAdapter, 'getTransactionStatus')
      .mockResolvedValue(txStatus('abc', true, 1));
    const commits: (string | undefined)[] = [];
    const { rerender, unmount } = renderHook(
      ({ txid }: { txid: string }) => {
        const result = useMempoolTxConfirmations(txid);
        useLayoutEffect(() => {
          commits.push(result.status?.txid);
        });
        return result;
      },
      { initialProps: { txid: 'abc' } }
    );
    await flushEffects();
    commits.length = 0;
    rerender({ txid: 'def' });
    expect(commits).not.toContain('abc');
    unmount();
  });

  it.each(['background', 'blur'] as const)(
    'waits for a pending request across a fast %s/resume and ignores its stale result',
    async (pause) => {
      const pending = deferred<ChainTransactionStatus | null>();
      const refreshed = deferred<ChainTransactionStatus | null>();
      const getStatus = jest
        .spyOn(defaultChainAdapter, 'getTransactionStatus')
        .mockReturnValueOnce(pending.promise)
        .mockReturnValueOnce(refreshed.promise);
      const { result, rerender, unmount } = renderHook(() => useMempoolTxConfirmations('abc'));
      if (pause === 'background') {
        act(() => appStateChanged('background'));
        act(() => appStateChanged('active'));
      } else {
        mockFocused = false;
        rerender({});
        mockFocused = true;
        rerender({});
      }
      await act(async () => jest.advanceTimersByTimeAsync(POLL_MS * 3));
      expect(getStatus).toHaveBeenCalledTimes(1);
      pending.resolve(txStatus('abc', true, 10));
      await flushEffects();
      expect(getStatus).toHaveBeenCalledTimes(2);
      expect(result.current.status).toBeNull();
      refreshed.resolve(txStatus('abc', false, 0));
      await flushEffects();
      expect(result.current.status?.confirmations).toBe(0);
      expect(result.current.isLoading).toBe(false);
      unmount();
    }
  );

  it('stops at required depth across resume, and restarts when greater depth is requested', async () => {
    const next = deferred<ChainTransactionStatus | null>();
    const getStatus = jest
      .spyOn(defaultChainAdapter, 'getTransactionStatus')
      .mockResolvedValueOnce(txStatus('abc', true, 3))
      .mockReturnValueOnce(next.promise);
    const { result, rerender, unmount } = renderHook(
      ({ depth }: { depth: number }) =>
        useMempoolTxConfirmations('abc', { requiredConfirmations: depth }),
      { initialProps: { depth: 3 } }
    );
    await flushEffects();
    act(() => appStateChanged('background'));
    act(() => appStateChanged('active'));
    mockFocused = false;
    rerender({ depth: 3 });
    mockFocused = true;
    rerender({ depth: 3 });
    await act(async () => jest.advanceTimersByTimeAsync(POLL_MS * 3));
    expect(getStatus).toHaveBeenCalledTimes(1);
    rerender({ depth: 6 });
    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(result.current.status?.confirmations).toBe(3);
    expect(result.current.isLoading).toBe(true);
    next.resolve(txStatus('abc', true, 6));
    await flushEffects();
    await act(async () => jest.advanceTimersByTimeAsync(POLL_MS * 3));
    expect(getStatus).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('does not start requests until a backgrounded detail becomes active', async () => {
    jest.spyOn(AppState, 'currentState', 'get').mockReturnValue('background');
    const getStatus = jest
      .spyOn(defaultChainAdapter, 'getTransactionStatus')
      .mockResolvedValue(txStatus('abc', false, 0));
    const { unmount } = renderHook(() => useMempoolTxConfirmations('abc'));
    await act(async () => jest.advanceTimersByTimeAsync(POLL_MS * 3));
    expect(getStatus).not.toHaveBeenCalled();
    act(() => appStateChanged('active'));
    await flushEffects();
    expect(getStatus).toHaveBeenCalledTimes(1);
    unmount();
  });

  beforeEach(() => {
    jest.useFakeTimers();
    mockFocused = true;
    jest.spyOn(AppState, 'currentState', 'get').mockReturnValue('active');
    jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
      if (event === 'change') appStateChanged = listener;
      return { remove: jest.fn() };
    });
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('polls immediately and every thirty seconds after the transaction is confirmed', async () => {
    const getTransactionStatus = jest
      .spyOn(defaultChainAdapter, 'getTransactionStatus')
      .mockResolvedValueOnce(txStatus('abc', false, 0))
      .mockResolvedValueOnce(txStatus('abc', true, 1))
      .mockResolvedValueOnce(txStatus('abc', true, 2))
      .mockResolvedValueOnce(txStatus('abc', true, 3));

    const { result, unmount } = renderHook(() => useMempoolTxConfirmations('abc'));
    await flushEffects();

    expect(getTransactionStatus).toHaveBeenCalledTimes(1);
    expect(getTransactionStatus).toHaveBeenLastCalledWith('abc');
    expect(result.current.status).toEqual(txStatus('abc', false, 0));

    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS - 1);
    });
    expect(getTransactionStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(getTransactionStatus).toHaveBeenCalledTimes(2);
    expect(result.current.status).toEqual(txStatus('abc', true, 1));

    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS * 2);
    });
    expect(getTransactionStatus).toHaveBeenCalledTimes(4);
    expect(result.current.status).toEqual(txStatus('abc', true, 3));

    unmount();
  });

  it('retains the last status after rejection and clears the error on the next poll', async () => {
    const firstStatus = txStatus('abc', false, 0);
    const nextStatus = txStatus('abc', true, 1);
    const getTransactionStatus = jest
      .spyOn(defaultChainAdapter, 'getTransactionStatus')
      .mockResolvedValueOnce(firstStatus)
      .mockRejectedValueOnce(new Error('mempool unavailable'))
      .mockResolvedValueOnce(nextStatus);

    const { result, unmount } = renderHook(() => useMempoolTxConfirmations('abc'));
    await flushEffects();
    expect(result.current.status).toEqual(firstStatus);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(getTransactionStatus).toHaveBeenCalledTimes(2);
    expect(result.current.status).toEqual(firstStatus);
    expect(result.current.error).toEqual(new Error('mempool unavailable'));
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(getTransactionStatus).toHaveBeenCalledTimes(3);
    expect(result.current.status).toEqual(nextStatus);
    expect(result.current.error).toBeNull();

    unmount();
  });

  it('normalizes txids, keeps an equivalent txid on one effect, and clears on change', async () => {
    const nextTx = deferred<ChainTransactionStatus | null>();
    const getTransactionStatus = jest
      .spyOn(defaultChainAdapter, 'getTransactionStatus')
      .mockResolvedValueOnce(txStatus('abc', false, 0))
      .mockImplementationOnce(() => nextTx.promise);

    const { rerender, result, unmount } = renderHook(
      ({ txid }: { txid: string | null }) => useMempoolTxConfirmations(txid),
      { initialProps: { txid: '  ABC  ' } }
    );
    await flushEffects();
    expect(getTransactionStatus).toHaveBeenCalledWith('abc');
    expect(result.current.status).toEqual(txStatus('abc', false, 0));

    rerender({ txid: 'abc' });
    expect(getTransactionStatus).toHaveBeenCalledTimes(1);
    expect(result.current.status).toEqual(txStatus('abc', false, 0));

    rerender({ txid: '  DEF  ' });
    expect(getTransactionStatus).toHaveBeenLastCalledWith('def');
    expect(result.current.status).toBeNull();
    expect(result.current.isLoading).toBe(true);

    nextTx.resolve(txStatus('def', false, 0));
    await flushEffects();
    expect(result.current.status).toEqual(txStatus('def', false, 0));

    rerender({ txid: '   ' });
    expect(result.current.status).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
    const callsAtClear = getTransactionStatus.mock.calls.length;

    await act(async () => {
      await jest.advanceTimersByTimeAsync(POLL_MS * 3);
    });
    expect(getTransactionStatus).toHaveBeenCalledTimes(callsAtClear);

    unmount();
  });

  it('ignores a late old-tx response after the txid changes', async () => {
    const oldTx = deferred<ChainTransactionStatus | null>();
    const newTx = deferred<ChainTransactionStatus | null>();
    const getTransactionStatus = jest
      .spyOn(defaultChainAdapter, 'getTransactionStatus')
      .mockImplementation((txid) => (txid === 'aaa' ? oldTx.promise : newTx.promise));

    const { rerender, result, unmount } = renderHook(
      ({ txid }: { txid: string }) => useMempoolTxConfirmations(txid),
      { initialProps: { txid: 'aaa' } }
    );
    rerender({ txid: 'bbb' });
    expect(getTransactionStatus.mock.calls).toEqual([['aaa'], ['bbb']]);

    oldTx.resolve(txStatus('aaa', true, 5));
    await flushEffects();
    expect(result.current.status).toBeNull();

    newTx.resolve(txStatus('bbb', false, 0));
    await flushEffects();
    expect(result.current.status).toEqual(txStatus('bbb', false, 0));

    unmount();
  });

  it('suppresses a late state write after unmount', async () => {
    const pending = deferred<ChainTransactionStatus | null>();
    const getTransactionStatus = jest
      .spyOn(defaultChainAdapter, 'getTransactionStatus')
      .mockImplementation(() => pending.promise);

    const { result, unmount } = renderHook(() => useMempoolTxConfirmations('abc'));
    expect(result.current.status).toBeNull();
    expect(result.current.isLoading).toBe(true);

    unmount();
    pending.resolve(txStatus('abc', true, 1));
    await flushEffects();

    expect(result.current.status).toBeNull();
    expect(result.current.isLoading).toBe(true);
    expect(getTransactionStatus).toHaveBeenCalledTimes(1);
  });
});
