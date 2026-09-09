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
});

test('an older balance read cannot overwrite a newer event-driven balance', async () => {
  type Balance = { spendable: number; reserved: number; total: number };
  const older = deferred<Balance>();
  const newer = deferred<Balance>();
  mockManager.wallet.balances.total
    .mockReturnValueOnce(older.promise)
    .mockReturnValueOnce(newer.promise);
  const { result } = renderHook(() => useColadaBalance());
  await act(async () => {
    mockListeners.get('proofs:saved')!();
  });
  await act(async () => {
    newer.resolve({ spendable: 200, reserved: 0, total: 200 });
  });
  expect(result.current.total).toBe(200);
  await act(async () => {
    older.resolve({ spendable: 100, reserved: 0, total: 100 });
  });
  expect(result.current.total).toBe(200);
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
