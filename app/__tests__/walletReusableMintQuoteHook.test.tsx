/**
 * @jest-environment node
 *
 * Characterization of `useReusableMintQuote`, the hook behind the standing
 * bolt12 offer / onchain address on the receive tabs. The real hook runs on
 * the real `wallet/src/quotes/reusable.ts` helper and an in-memory identity
 * store; only the provider's Manager seam (`useColadaManager`) is replaced by
 * a fake Coco manager.
 */

import { act, renderHook } from '@testing-library/react-native';

import {
  reusableQuoteKey,
  type EnsureReusableMintQuoteInput,
  type ReusableQuoteIdentityStore,
} from '../../wallet/src/quotes/reusable';
import { useReusableMintQuote } from '../../wallet/src/react/useReusableMintQuote';

jest.mock('../../wallet/src/react/ColadaProvider', () => ({
  useColadaManager: () => mockManager,
}));

const MINT = 'https://mint.example';
const INPUT: EnsureReusableMintQuoteInput = { mintUrl: MINT, method: 'onchain', unit: 'sat' };
const KEY = reusableQuoteKey(INPUT);

type Quote = {
  quoteId: string;
  mintUrl: string;
  method: 'onchain' | 'bolt12';
  unit: string;
  reusable: boolean;
  expiry: number | null;
  createdAt: number;
  request: string;
  amountPaid?: number;
};

function quote(quoteId: string, extra: Partial<Quote> = {}): Quote {
  return {
    quoteId,
    mintUrl: MINT,
    method: 'onchain',
    unit: 'sat',
    reusable: true,
    expiry: null,
    createdAt: 1,
    request: `bc1q${quoteId}`,
    ...extra,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type Listener = (payload: { mintUrl: string; quoteId: string }) => void;

function createFakeManager() {
  const listeners = new Set<Listener>();
  const quotes = new Map<string, Quote>();
  let created = 0;
  const manager = {
    quotes: {
      mint: {
        get: jest.fn(async ({ quoteId }: { quoteId: string }) => quotes.get(quoteId) ?? null),
        create: jest.fn(async (_args: { mintUrl: string; method: string; unit: string }) => {
          created += 1;
          const q = quote(`created-${created}`);
          quotes.set(q.quoteId, q);
          return q;
        }),
      },
    },
    on: jest.fn((_event: string, listener: Listener) => listeners.add(listener)),
    off: jest.fn((_event: string, listener: Listener) => listeners.delete(listener)),
  };
  return {
    manager,
    quotes,
    emit: (payload: { mintUrl: string; quoteId: string }) => listeners.forEach((l) => l(payload)),
    listenerCount: () => listeners.size,
  };
}

function createMemoryIdentityStore(): ReusableQuoteIdentityStore & {
  setExternally: (key: string, id: string) => void;
} {
  const values = new Map<string, string>();
  const subscribers = new Map<string, Set<() => void>>();
  return {
    get: (key) => values.get(key),
    set: (key, id) => {
      values.set(key, id);
    },
    subscribe: (key, callback) => {
      const set = subscribers.get(key) ?? new Set();
      set.add(callback);
      subscribers.set(key, set);
      return () => set.delete(callback);
    },
    setExternally: (key, id) => {
      values.set(key, id);
      subscribers.get(key)?.forEach((cb) => cb());
    },
  };
}

let fake = createFakeManager();
let mockManager: unknown = fake.manager;
let store = createMemoryIdentityStore();

beforeEach(() => {
  fake = createFakeManager();
  mockManager = fake.manager;
  store = createMemoryIdentityStore();
});

const flush = () => act(async () => {});

test('with nothing recorded it shows loading, then creates, records and shows one quote', async () => {
  const { result } = renderHook(() => useReusableMintQuote({ ...INPUT, unit: ' SAT ' }, store));
  expect(result.current.quote).toBeNull();
  expect(result.current.isLoading).toBe(true);

  await flush();

  expect(result.current.isLoading).toBe(false);
  expect(result.current.quote?.quoteId).toBe('created-1');
  expect(store.get(KEY)).toBe('created-1');
  expect(fake.manager.quotes.mint.create).toHaveBeenCalledTimes(1);
  expect(fake.manager.quotes.mint.create).toHaveBeenCalledWith({
    mintUrl: MINT,
    method: 'onchain',
    unit: 'sat',
  });
});

test('a recorded live quote is shown again without creating another', async () => {
  fake.quotes.set('kept', quote('kept'));
  store.set(KEY, 'kept');
  const { result } = renderHook(() => useReusableMintQuote(INPUT, store));
  await flush();

  expect(result.current.quote?.quoteId).toBe('kept');
  expect(fake.manager.quotes.mint.create).not.toHaveBeenCalled();
});

test('a recorded quote with expiry 0 is still reused, while an expired one is replaced', async () => {
  // QUIRK: expiry 0 means "never expires" here, although Coco's own expiry
  // check treats 0 as already expired. A later fix should change this on purpose.
  fake.quotes.set('zero', quote('zero', { expiry: 0 }));
  store.set(KEY, 'zero');
  const first = renderHook(() => useReusableMintQuote(INPUT, store));
  await flush();
  expect(first.result.current.quote?.quoteId).toBe('zero');
  expect(fake.manager.quotes.mint.create).not.toHaveBeenCalled();
  first.unmount();

  fake = createFakeManager();
  mockManager = fake.manager;
  fake.quotes.set('old', quote('old', { expiry: 1000 }));
  store.set(KEY, 'old');
  const second = renderHook(() => useReusableMintQuote(INPUT, store));
  await flush();
  expect(second.result.current.quote?.quoteId).toBe('created-1');
  expect(store.get(KEY)).toBe('created-1');
});

test('a remount on the same manager shows the last quote at once and revalidates quietly', async () => {
  const first = renderHook(() => useReusableMintQuote(INPUT, store));
  await flush();
  first.unmount();
  fake.manager.quotes.mint.get.mockClear();

  const second = renderHook(() => useReusableMintQuote(INPUT, store));
  expect(second.result.current.quote?.quoteId).toBe('created-1');
  expect(second.result.current.isLoading).toBe(false);
  await flush();
  expect(fake.manager.quotes.mint.get).toHaveBeenCalledTimes(1);
  expect(fake.manager.quotes.mint.create).toHaveBeenCalledTimes(1);
});

test('only an update for this quote at this mint re-reads it', async () => {
  const { result } = renderHook(() => useReusableMintQuote(INPUT, store));
  await flush();
  fake.manager.quotes.mint.get.mockClear();

  await act(async () => {
    fake.emit({ mintUrl: MINT, quoteId: 'someone-else' });
    fake.emit({ mintUrl: 'https://other.example', quoteId: 'created-1' });
  });
  expect(fake.manager.quotes.mint.get).not.toHaveBeenCalled();

  fake.quotes.set('created-1', quote('created-1', { amountPaid: 500 }));
  await act(async () => {
    fake.emit({ mintUrl: MINT, quoteId: 'created-1' });
  });
  expect(fake.manager.quotes.mint.get).toHaveBeenCalledTimes(1);
  expect(result.current.quote?.amountPaid).toBe(500);
});

test('rotate keeps the current quote on screen until the new one is created', async () => {
  const { result } = renderHook(() => useReusableMintQuote(INPUT, store));
  await flush();

  const pending = deferred<Quote>();
  fake.manager.quotes.mint.create.mockImplementationOnce(() => pending.promise);
  let rotation: Promise<boolean> = Promise.resolve(false);
  await act(async () => {
    rotation = result.current.rotate('deposit_received');
  });
  // QUIRK: no loading state during a rotation; the retired address stays
  // visible (and payable) until its replacement resolves.
  expect(result.current.quote?.quoteId).toBe('created-1');
  expect(result.current.isLoading).toBe(false);

  await act(async () => {
    const next = quote('rotated');
    fake.quotes.set('rotated', next);
    pending.resolve(next);
    await expect(rotation).resolves.toBe(true);
  });
  expect(result.current.quote?.quoteId).toBe('rotated');
  expect(store.get(KEY)).toBe('rotated');
});

test('a failed rotate reports the error and keeps the current quote', async () => {
  const { result } = renderHook(() => useReusableMintQuote(INPUT, store));
  await flush();
  fake.manager.quotes.mint.create.mockRejectedValueOnce(new Error('mint offline'));

  await act(async () => {
    await expect(result.current.rotate()).resolves.toBe(false);
  });
  expect(result.current.error).toEqual({ message: 'mint offline', authored: false });
  expect(result.current.quote?.quoteId).toBe('created-1');
  expect(store.get(KEY)).toBe('created-1');
});

test('a rotation recorded from outside swaps the mounted quote; re-recording the same id does not', async () => {
  const { result } = renderHook(() => useReusableMintQuote(INPUT, store));
  await flush();
  fake.manager.quotes.mint.get.mockClear();

  await act(async () => store.setExternally(KEY, 'created-1'));
  expect(fake.manager.quotes.mint.get).not.toHaveBeenCalled();

  fake.quotes.set('from-listener', quote('from-listener'));
  await act(async () => store.setExternally(KEY, 'from-listener'));
  expect(result.current.quote?.quoteId).toBe('from-listener');
  expect(fake.manager.quotes.mint.create).toHaveBeenCalledTimes(1);
});

test('a failed load reports the error', async () => {
  fake.manager.quotes.mint.create.mockRejectedValueOnce(new Error('no route'));
  const { result } = renderHook(() => useReusableMintQuote(INPUT, store));
  await flush();
  expect(result.current.error).toEqual({ message: 'no route', authored: false });
  expect(result.current.isLoading).toBe(false);
  expect(result.current.quote).toBeNull();
});

test('a null input clears the quote, the loading flag and the error', async () => {
  const { result, rerender } = renderHook(
    ({ input }: { input: EnsureReusableMintQuoteInput | null }) =>
      useReusableMintQuote(input, store),
    { initialProps: { input: INPUT as EnsureReusableMintQuoteInput | null } }
  );
  await flush();
  expect(result.current.quote).not.toBeNull();

  rerender({ input: null });
  await flush();
  expect(result.current).toMatchObject({ quote: null, isLoading: false, error: null });
});

test('a slow load for the previous mint never replaces the quote of the mint now shown', async () => {
  const OTHER = 'https://other.example';
  const slow = deferred<Quote>();
  fake.manager.quotes.mint.create.mockImplementationOnce(() => slow.promise);
  const { result, rerender } = renderHook(
    ({ input }: { input: EnsureReusableMintQuoteInput }) => useReusableMintQuote(input, store),
    { initialProps: { input: INPUT } }
  );
  rerender({ input: { ...INPUT, mintUrl: OTHER } });
  await flush();
  expect(result.current.quote?.quoteId).toBe('created-1');

  await act(async () => slow.resolve(quote('late-for-first-mint')));
  expect(result.current.quote?.quoteId).toBe('created-1');
});

test('unmounting stops listening for quote updates', async () => {
  const { unmount } = renderHook(() => useReusableMintQuote(INPUT, store));
  await flush();
  expect(fake.listenerCount()).toBe(1);
  unmount();
  expect(fake.listenerCount()).toBe(0);
});
