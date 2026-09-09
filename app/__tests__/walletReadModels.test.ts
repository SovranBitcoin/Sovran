import { Amount } from '@cashu/coco-core';
import { createInMemoryAnnotationStore } from '../../wallet/src/annotations/store';
import { act, renderHook } from '@testing-library/react-native';
import { useColadaBalance } from '../../wallet/src/react/useColadaBalance';
import { useColadaTransactions } from '../../wallet/src/react/useColadaTransactions';

// The app renderer and workspace hooks must share React's dispatcher.
jest.mock('../../wallet/node_modules/react', () => jest.requireActual('react'));
jest.mock('../../wallet/src/react/ColadaProvider', () => ({
  useColadaManager: () => mockActiveManager,
  useAnnotationStore: () => mockAnnotations,
}));

const mockListeners = new Map<string, () => void>();
let mockAnnotations = createInMemoryAnnotationStore();
const mockManager = {
  wallet: { balances: { total: jest.fn(), byMint: jest.fn(async () => ({})) } },
  history: { getPaginatedHistory: jest.fn() },
  ops: { receive: { listInFlight: jest.fn(async () => []) } },
  paymentRequests: { incoming: { list: jest.fn(async () => []) } },
  on: (event: string, listener: () => void) => mockListeners.set(event, listener),
  off: (event: string) => mockListeners.delete(event),
};

let mockActiveManager = mockManager;

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const mint = (id: string, remoteState = 'UNPAID') => ({
  id,
  type: 'mint',
  state: 'pending',
  remoteState,
  createdAt: 1000,
  mintUrl: 'https://mint.example',
  amount: Amount.from(1),
  unit: 'sat',
  source: 'operation',
  operationId: id,
  quoteId: id,
  paymentRequest: '',
  updatedAt: 1000,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockListeners.clear();
  mockActiveManager = mockManager;
  mockAnnotations = createInMemoryAnnotationStore();
  mockManager.history.getPaginatedHistory.mockReset().mockResolvedValue([]);
  mockManager.wallet.balances.total.mockReset();
  mockManager.wallet.balances.byMint.mockReset().mockResolvedValue({});
  mockManager.ops.receive.listInFlight.mockReset().mockResolvedValue([]);
  mockManager.paymentRequests.incoming.list.mockReset().mockResolvedValue([]);
});

function mintBalance(spendable: number, reserved = 0) {
  return {
    spendable: Amount.from(spendable),
    reserved: Amount.from(reserved),
    total: Amount.from(spendable + reserved),
    unit: 'sat',
  };
}

test('balance totals share one per-mint snapshot without a second proof scan', async () => {
  mockManager.wallet.balances.byMint.mockResolvedValue({
    'https://mint-one.example': mintBalance(100, 20),
    'https://mint-two.example': mintBalance(200, 30),
  });
  const { result } = renderHook(() => useColadaBalance());
  await act(async () => {});
  expect(result.current).toMatchObject({ spendable: 300, reserved: 50, total: 350 });
  expect(mockManager.wallet.balances.byMint).toHaveBeenCalledTimes(1);
  expect(mockManager.wallet.balances.byMint).toHaveBeenCalledWith({ units: ['sat'] });
  expect(mockManager.wallet.balances.total).not.toHaveBeenCalled();
});

test('balance event bursts coalesce into one trailing read without publishing the invalidated snapshot', async () => {
  const older = deferred<Record<string, ReturnType<typeof mintBalance>>>();
  const newer = deferred<Record<string, ReturnType<typeof mintBalance>>>();
  mockManager.wallet.balances.byMint
    .mockReturnValueOnce(older.promise)
    .mockReturnValueOnce(newer.promise);
  const { result } = renderHook(() => useColadaBalance());
  await act(async () => {
    for (let i = 0; i < 20; i++) mockListeners.get('proofs:saved')!();
  });
  expect(mockManager.wallet.balances.byMint).toHaveBeenCalledTimes(1);
  await act(async () => {
    older.resolve({ 'https://mint.example': mintBalance(100) });
  });
  expect(result.current.total).toBe(0);
  expect(mockManager.wallet.balances.byMint).toHaveBeenCalledTimes(2);
  await act(async () => {
    newer.resolve({ 'https://mint.example': mintBalance(200) });
  });
  expect(result.current.total).toBe(200);
  expect(mockManager.history.getPaginatedHistory).toHaveBeenCalledTimes(2);
});

test('an old manager cannot publish a balance or run queued work after a profile switch', async () => {
  const older = deferred<Record<string, ReturnType<typeof mintBalance>>>();
  mockManager.wallet.balances.byMint.mockReturnValueOnce(older.promise);
  const { result, rerender } = renderHook(() => useColadaBalance());
  act(() => mockListeners.get('proofs:saved')!());
  const byMint = jest.fn().mockResolvedValue({ 'https://new.example': mintBalance(200) });
  mockActiveManager = {
    ...mockManager,
    wallet: { balances: { ...mockManager.wallet.balances, byMint } },
  };
  rerender({});
  await act(async () => {});
  expect(result.current.total).toBe(200);
  await act(async () => older.resolve({ 'https://old.example': mintBalance(100) }));
  expect(result.current.total).toBe(200);
  expect(mockManager.wallet.balances.byMint).toHaveBeenCalledTimes(1);
  expect(byMint).toHaveBeenCalledTimes(1);
});

test('a balance read from the previous unit cannot overwrite the newly selected unit', async () => {
  const older = deferred<Record<string, ReturnType<typeof mintBalance>>>();
  mockManager.wallet.balances.byMint
    .mockReturnValueOnce(older.promise)
    .mockResolvedValueOnce({ 'https://mint.example': { ...mintBalance(200), unit: 'usd' } });
  const { result, rerender } = renderHook(({ unit }: { unit: string }) => useColadaBalance(unit), {
    initialProps: { unit: 'sat' },
  });
  rerender({ unit: 'usd' });
  await act(async () => {});
  expect(result.current.total).toBe(200);
  await act(async () => older.resolve({ 'https://mint.example': mintBalance(100) }));
  expect(result.current.total).toBe(200);
  expect(mockManager.wallet.balances.byMint.mock.calls).toEqual([
    [{ units: ['sat'] }],
    [{ units: ['usd'] }],
  ]);
});

test('failed balance refreshes retain the last snapshot and allow the next event to retry', async () => {
  mockManager.wallet.balances.byMint
    .mockResolvedValueOnce({ 'https://mint.example': mintBalance(100) })
    .mockRejectedValueOnce(new Error('database busy'))
    .mockResolvedValueOnce({ 'https://mint.example': mintBalance(200) });
  const { result } = renderHook(() => useColadaBalance());
  await act(async () => {});
  expect(result.current.total).toBe(100);
  await act(async () => mockListeners.get('proofs:saved')!());
  expect(result.current.total).toBe(100);
  await act(async () => mockListeners.get('proofs:saved')!());
  expect(result.current.total).toBe(200);
});

test.each(['unit', 'manager'])(
  'a %s switch hides the previous balance on its first render',
  async (scope) => {
    const pending = deferred<Record<string, ReturnType<typeof mintBalance>>>();
    mockManager.wallet.balances.byMint.mockResolvedValueOnce({
      'https://mint.example': mintBalance(100),
    });
    const rendered: number[] = [];
    const { result, rerender } = renderHook(
      ({ unit }: { unit: string }) => {
        const balance = useColadaBalance(unit);
        rendered.push(balance.total);
        return balance;
      },
      { initialProps: { unit: 'sat' } }
    );
    await act(async () => {});
    expect(result.current.total).toBe(100);
    rendered.length = 0;
    if (scope === 'manager') {
      mockActiveManager = {
        ...mockManager,
        wallet: {
          balances: { ...mockManager.wallet.balances, byMint: jest.fn(() => pending.promise) },
        },
      };
    } else {
      mockManager.wallet.balances.byMint.mockReturnValueOnce(pending.promise);
    }
    rerender({ unit: scope === 'unit' ? 'usd' : 'sat' });
    expect(rendered.every((total) => total === 0)).toBe(true);
    expect(result.current.byMint).toEqual({});
    await act(async () => pending.resolve({ 'https://new.example': mintBalance(200) }));
    expect(result.current.total).toBe(200);
  }
);

test('unmounting stops queued balance reads', async () => {
  const older = deferred<Record<string, ReturnType<typeof mintBalance>>>();
  mockManager.wallet.balances.byMint.mockReturnValueOnce(older.promise);
  const { unmount } = renderHook(() => useColadaBalance());
  act(() => mockListeners.get('proofs:saved')!());
  unmount();
  await act(async () => older.resolve({ 'https://mint.example': mintBalance(100) }));
  expect(mockManager.wallet.balances.byMint).toHaveBeenCalledTimes(1);
  expect(mockListeners.size).toBe(0);
});

test('history loads its independent supplements while the first page is still pending', async () => {
  const page = deferred<ReturnType<typeof mint>[]>();
  mockManager.history.getPaginatedHistory.mockReturnValueOnce(page.promise);
  const { result } = renderHook(() => useColadaTransactions());
  await act(async () => {});
  expect(mockManager.ops.receive.listInFlight).toHaveBeenCalledTimes(1);
  expect(mockManager.paymentRequests.incoming.list).toHaveBeenCalledTimes(1);
  expect(result.current.isFetching).toBe(true);
  await act(async () => page.resolve([mint('mint:first')]));
  expect(result.current.history[0].id).toBe('mint:first');
});

test('receive lifecycle bursts share one supplement read and preserve a trailing refresh', async () => {
  const first = deferred<never[]>();
  const trailing = deferred<never[]>();
  mockManager.ops.receive.listInFlight
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(trailing.promise);
  const { result } = renderHook(() => useColadaTransactions());
  await act(async () => {
    for (let i = 0; i < 20; i++) mockListeners.get('receive-op:finalized')!();
  });
  expect(mockManager.ops.receive.listInFlight).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve([]));
  expect(mockManager.ops.receive.listInFlight).toHaveBeenCalledTimes(2);
  expect(result.current.isFetching).toBe(true);
  await act(async () => trailing.resolve([]));
  expect(result.current.isFetching).toBe(false);
  expect(mockManager.paymentRequests.incoming.list).toHaveBeenCalledTimes(2);
});

test('history events during pagination trigger one trailing refresh without losing loaded pages', async () => {
  mockManager.history.getPaginatedHistory.mockResolvedValueOnce([mint('mint:first')]);
  const { result } = renderHook(() => useColadaTransactions(1));
  await act(async () => {});
  const page = deferred<ReturnType<typeof mint>[]>();
  mockManager.history.getPaginatedHistory
    .mockReturnValueOnce(page.promise)
    .mockResolvedValueOnce([mint('mint:first', 'PAID')]);
  act(() => {
    void result.current.loadMore();
  });
  await act(async () => {
    for (let i = 0; i < 20; i++) mockListeners.get('history:updated')!();
  });
  expect(mockManager.history.getPaginatedHistory).toHaveBeenCalledTimes(2);
  await act(async () => page.resolve([mint('mint:second')]));
  expect(mockManager.history.getPaginatedHistory.mock.calls.map(([offset]) => offset)).toEqual([
    0, 1, 0,
  ]);
  expect(result.current.history.map(({ id }) => id)).toEqual(['mint:first', 'mint:second']);
  expect(result.current.history[0]).toMatchObject({ remoteState: 'PAID' });
});

test('history publishes a changed remote quote state before operation state advances', async () => {
  mockManager.history.getPaginatedHistory.mockResolvedValue([mint('mint:first')]);
  const { result } = renderHook(() => useColadaTransactions(1));
  await act(async () => {});
  expect(result.current.history[0]).toMatchObject({ remoteState: 'UNPAID' });
  mockManager.history.getPaginatedHistory.mockResolvedValue([mint('mint:first', 'PAID')]);
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.history[0]).toMatchObject({ remoteState: 'PAID' });
});

test('a failed next-page read retains its offset and can be retried', async () => {
  mockManager.history.getPaginatedHistory.mockResolvedValue([mint('mint:first')]);
  const { result } = renderHook(() => useColadaTransactions(1));
  await act(async () => {});
  mockManager.history.getPaginatedHistory.mockRejectedValueOnce(new Error('database busy'));
  await act(async () => {
    await result.current.loadMore();
  });
  expect(result.current.hasMore).toBe(true);
  expect(result.current.isFetching).toBe(false);
  expect(result.current.history.map((entry) => entry.id)).toEqual(['mint:first']);
  mockManager.history.getPaginatedHistory.mockResolvedValueOnce([mint('mint:second')]);
  await act(async () => {
    await result.current.loadMore();
  });
  expect(mockManager.history.getPaginatedHistory.mock.calls.map(([offset]) => offset)).toEqual([
    0, 1, 1,
  ]);
  expect(result.current.history.map((entry) => entry.id)).toEqual(['mint:first', 'mint:second']);
});

test('unchanged history and unrelated annotations preserve identity, changed amounts and annotations publish', async () => {
  mockManager.history.getPaginatedHistory.mockImplementation(async () => [mint('mint:first')]);
  const { result } = renderHook(() => useColadaTransactions());
  await act(async () => {});
  const original = result.current.history;
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.history).toBe(original);
  act(() => mockAnnotations.set('id:unrelated', { distributionSource: 'copy' }));
  expect(result.current.history).toBe(original);
  act(() => mockAnnotations.set('id:mint:first', { distributionSource: 'copy' }));
  expect(result.current.history).not.toBe(original);
  expect(result.current.history[0].metadata).toMatchObject({ distributionSource: 'copy' });
  mockManager.history.getPaginatedHistory.mockResolvedValue([
    { ...mint('mint:first'), amount: Amount.from(2) },
  ]);
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.history[0].amount.toNumber()).toBe(2);
});

test('a failed initial page retries offset zero and a successful refresh updates exhaustion', async () => {
  mockManager.history.getPaginatedHistory.mockRejectedValueOnce(new Error('database busy'));
  const { result } = renderHook(() => useColadaTransactions(1));
  await act(async () => {});
  expect(result.current.hasMore).toBe(true);
  mockManager.history.getPaginatedHistory.mockResolvedValueOnce([mint('mint:first')]);
  await act(async () => {
    await result.current.loadMore();
  });
  expect(mockManager.history.getPaginatedHistory.mock.calls.map(([offset]) => offset)).toEqual([
    0, 0,
  ]);
  mockManager.history.getPaginatedHistory.mockResolvedValueOnce([]);
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.hasMore).toBe(false);
});

test('a failed first read on a new manager clears old rows and retries the new account', async () => {
  mockManager.history.getPaginatedHistory.mockResolvedValue([mint('old-account')]);
  const { result, rerender } = renderHook(() => useColadaTransactions(2));
  await act(async () => {});
  expect(result.current.hasMore).toBe(false);
  const newRead = jest
    .fn()
    .mockRejectedValueOnce(new Error('database busy'))
    .mockResolvedValue([mint('new-account')]);
  mockActiveManager = { ...mockManager, history: { getPaginatedHistory: newRead } };
  rerender({});
  await act(async () => {});
  expect(result.current.history).toEqual([]);
  expect(result.current.hasMore).toBe(true);
  await act(async () => {
    await result.current.loadMore();
  });
  expect(result.current.history.map((entry) => entry.id)).toEqual(['new-account']);
  expect(newRead.mock.calls.map(([offset]) => offset)).toEqual([0, 0]);
});

test('an old manager refresh cannot publish rows or clear a new manager loading state', async () => {
  mockManager.history.getPaginatedHistory.mockResolvedValue([mint('old-account')]);
  const { result, rerender } = renderHook(() => useColadaTransactions());
  await act(async () => {});
  const oldRead = deferred<ReturnType<typeof mint>[]>();
  mockManager.history.getPaginatedHistory.mockReturnValueOnce(oldRead.promise);
  let oldRefresh: Promise<void> = Promise.resolve();
  act(() => {
    oldRefresh = result.current.refresh();
  });
  const newRead = deferred<ReturnType<typeof mint>[]>();
  mockActiveManager = {
    ...mockManager,
    history: { getPaginatedHistory: jest.fn(() => newRead.promise) },
  };
  rerender({});
  await act(async () => {
    oldRead.resolve([mint('old-late')]);
    await oldRefresh;
  });
  expect(result.current.history).toEqual([]);
  expect(result.current.isFetching).toBe(true);
  await act(async () => {
    newRead.resolve([mint('new-account')]);
  });
  expect(result.current.history.map((entry) => entry.id)).toEqual(['new-account']);
  expect(result.current.isFetching).toBe(false);
});
