/**
 * @jest-environment node
 */

import { act, renderHook } from '@testing-library/react-native';

import { useKeyedSingleFlight, useSingleFlight } from '@/shared/hooks/useSingleFlight';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });

  return { promise, reject, resolve };
}

describe('useSingleFlight', () => {
  it('runs the winning call once and drops a concurrent duplicate', async () => {
    const gate = deferred<string>();
    const fn = jest.fn(() => gate.promise);
    const { result } = renderHook(() => useSingleFlight(fn));

    let winner!: Promise<string | undefined>;
    let duplicate!: Promise<string | undefined>;
    act(() => {
      winner = result.current();
      duplicate = result.current();
    });

    await expect(duplicate).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);

    gate.resolve('done');
    await expect(winner).resolves.toBe('done');
  });

  it('releases the lock after rejection', async () => {
    const first = deferred<string>();
    const fn = jest
      .fn<Promise<string>, []>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce('retry');
    const { result } = renderHook(() => useSingleFlight(fn));

    let failed!: Promise<string | undefined>;
    act(() => {
      failed = result.current();
    });
    first.reject(new Error('failed'));
    await expect(failed).rejects.toThrow('failed');

    await expect(result.current()).resolves.toBe('retry');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('useKeyedSingleFlight', () => {
  it('drops duplicate keys while allowing distinct keys in parallel', async () => {
    const gates = new Map([
      ['a', deferred<string>()],
      ['b', deferred<string>()],
    ]);
    const fn = jest.fn((key: string) => gates.get(key)!.promise);
    const keyOf = (key: string) => key;
    const { result } = renderHook(() => useKeyedSingleFlight(fn, keyOf));

    let firstA!: Promise<string | undefined>;
    let duplicateA!: Promise<string | undefined>;
    let firstB!: Promise<string | undefined>;
    act(() => {
      firstA = result.current('a');
      duplicateA = result.current('a');
      firstB = result.current('b');
    });

    await expect(duplicateA).resolves.toBeUndefined();
    expect(fn.mock.calls).toEqual([['a'], ['b']]);

    gates.get('a')!.resolve('A');
    gates.get('b')!.resolve('B');
    await expect(firstA).resolves.toBe('A');
    await expect(firstB).resolves.toBe('B');
  });

  it('releases only the completed key', async () => {
    const a = deferred<string>();
    const b = deferred<string>();
    const fn = jest
      .fn<Promise<string>, [key: string]>()
      .mockImplementationOnce(() => a.promise)
      .mockImplementationOnce(() => b.promise)
      .mockResolvedValueOnce('a-again');
    const { result } = renderHook(() => useKeyedSingleFlight(fn, (key) => key));

    const firstA = result.current('a');
    const firstB = result.current('b');
    a.resolve('A');
    await expect(firstA).resolves.toBe('A');

    await expect(result.current('a')).resolves.toBe('a-again');
    await expect(result.current('b')).resolves.toBeUndefined();

    b.resolve('B');
    await expect(firstB).resolves.toBe('B');
  });
});
