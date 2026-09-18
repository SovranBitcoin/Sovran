/**
 * Hunch rule async/owner-scope: `createQueryCacheStore.run` is generation-guarded. An older
 * forced read cannot overwrite a newer result on the same key; `clear()` and
 * an aborted signal reject a late completion without writing.
 */
import { createQueryCacheStore, isSupersededError } from '@/shared/lib/cache/createQueryCacheStore';

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let storeSeq = 0;
function makeStore() {
  storeSeq += 1;
  return createQueryCacheStore<string>({
    name: `gen-test-${storeSeq}`,
    staleTtlMs: 60_000,
    persist: false,
  });
}

describe('createQueryCacheStore generations', () => {
  it('an older forced run cannot overwrite a newer result on the same key', async () => {
    const store = makeStore();
    const a = deferred<{ data: string }>();
    const b = deferred<{ data: string }>();
    const first = store.run('k', () => a.promise, 'v');
    const second = store.run('k', () => b.promise, 'v', { force: true });
    expect(store.generation('k')).toBe(2);

    b.resolve({ data: 'B' });
    await expect(second).resolves.toBe('B');
    a.resolve({ data: 'A' });
    // The old awaiter receives the newer result; nothing wrote 'A'.
    await expect(first).resolves.toBe('B');
    expect(store.getEntry('k')?.data).toBe('B');
  });

  it('clear() rejects a late completion and writes nothing', async () => {
    const store = makeStore();
    const a = deferred<{ data: string }>();
    const pending = store.run('k', () => a.promise, 'v');
    store.clear();
    a.resolve({ data: 'A' });
    await expect(pending).rejects.toMatchObject({ name: 'SupersededError', reason: 'clear' });
    expect(store.getEntry('k')).toBeUndefined();
  });

  it('an aborted signal blocks the write and rejects as superseded', async () => {
    const store = makeStore();
    const a = deferred<{ data: string }>();
    const controller = new AbortController();
    const pending = store.run('k', () => a.promise, 'v', { signal: controller.signal });
    controller.abort();
    a.resolve({ data: 'A' });
    await expect(pending).rejects.toMatchObject({ name: 'SupersededError', reason: 'abort' });
    expect(isSupersededError(new Error('x'))).toBe(false);
    expect(store.getEntry('k')).toBeUndefined();
  });

  it('a concurrent unforced run joins the in-flight promise; a forced run replaces it', async () => {
    const store = makeStore();
    const a = deferred<{ data: string }>();
    const fetcher = jest.fn(() => a.promise);
    const first = store.run('k', fetcher, 'v');
    const joined = store.run('k', fetcher, 'v');
    expect(joined).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const b = deferred<{ data: string }>();
    const forced = store.run('k', () => b.promise, 'v', { force: true });
    expect(forced).not.toBe(first);
    b.resolve({ data: 'B' });
    a.resolve({ data: 'A' });
    await expect(forced).resolves.toBe('B');
    await expect(first).resolves.toBe('B');
  });

  it('partial() writes an early value under the same generation guard', async () => {
    const store = makeStore();
    const a = deferred<{ data: string }>();
    let partial!: (data: string) => void;
    const pending = store.run(
      'k',
      (ctx) => {
        partial = ctx.partial;
        return a.promise;
      },
      'v'
    );
    partial('early');
    expect(store.getEntry('k')?.data).toBe('early');
    store.clear();
    partial('too-late');
    expect(store.getEntry('k')).toBeUndefined();
    a.resolve({ data: 'final' });
    await expect(pending).rejects.toMatchObject({ reason: 'clear' });
  });

  it('a failed run rejects with the original error and leaves the entry untouched', async () => {
    const store = makeStore();
    store.setEntry('k', 'kept', { viewerKey: 'v' });
    const pending = store.run('k', () => Promise.reject(new Error('offline')), 'v', {
      force: true,
    });
    await expect(pending).rejects.toThrow('offline');
    expect(store.getEntry('k')?.data).toBe('kept');
  });
});
