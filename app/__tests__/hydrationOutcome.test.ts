import {
  hydrationSettled,
  loadRequiredStores,
  markHydrationFailed,
  markHydrationStarted,
} from '@/shared/lib/persist/hydrationOutcome';

/** A stand-in for a persisted store whose load the test decides. */
function fakeStore(name: string) {
  let hydrated = false;
  const finished = new Set<() => void>();
  const rehydrate = jest.fn(() => markHydrationStarted(name));
  return {
    store: {
      persist: {
        hasHydrated: () => hydrated,
        onFinishHydration: (listener: () => void) => {
          finished.add(listener);
          return () => finished.delete(listener);
        },
        rehydrate,
        getOptions: () => ({ name }),
      },
    },
    rehydrate,
    load: () => {
      hydrated = true;
      for (const listener of [...finished]) listener();
    },
    fail: () => markHydrationFailed(name),
    waiting: () => finished.size,
  };
}

describe('hydration outcome', () => {
  it('settles true for a store that has already loaded', async () => {
    const a = fakeStore('outcome-a');
    a.load();
    await expect(hydrationSettled(a.store)).resolves.toBe(true);
  });

  it('settles true when the load finishes later, and stops listening', async () => {
    const a = fakeStore('outcome-b');
    const settled = hydrationSettled(a.store);
    a.load();
    await expect(settled).resolves.toBe(true);
    expect(a.waiting()).toBe(0);
  });

  it('settles false when the saved data cannot be read, instead of waiting for ever', async () => {
    const a = fakeStore('outcome-c');
    const settled = hydrationSettled(a.store);
    a.fail();
    await expect(settled).resolves.toBe(false);
  });

  it('settles false for a failure that happened before anyone waited', async () => {
    const a = fakeStore('outcome-d');
    a.fail();
    await expect(hydrationSettled(a.store)).resolves.toBe(false);
  });

  it('refuses to start while a required store is unread, naming it', async () => {
    const good = fakeStore('outcome-good');
    const bad = fakeStore('outcome-bad');
    good.load();
    const loading = loadRequiredStores([good.store, bad.store]);
    bad.fail();
    await expect(loading).rejects.toThrow('outcome-bad');
    expect(good.rehydrate).not.toHaveBeenCalled();
  });

  it('reads a failed store again on the next attempt and starts once it loads', async () => {
    const bad = fakeStore('outcome-retry');
    bad.fail();
    const retry = loadRequiredStores([bad.store]);
    expect(bad.rehydrate).toHaveBeenCalledTimes(1);
    bad.load();
    await expect(retry).resolves.toBeUndefined();
  });

  it('fails the retry too when the store still cannot be read', async () => {
    const bad = fakeStore('outcome-still-bad');
    bad.fail();
    const retry = loadRequiredStores([bad.store]);
    bad.fail();
    await expect(retry).rejects.toThrow('outcome-still-bad');
  });
});

describe('hydration outcome of a real persisted store', () => {
  // Required lazily so the fake-store cases above stay free of the store stack.
  const { z } = jest.requireActual<typeof import('zod')>('zod');
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  const { persist } = jest.requireActual<typeof import('zustand/middleware')>('zustand/middleware');
  const { persistConfig } = jest.requireActual<typeof import('@/shared/lib/persist/persistConfig')>(
    '@/shared/lib/persist/persistConfig'
  );

  function mount(name: string, disk: Map<string, string>, read: { fails: boolean }) {
    return create<{ count: number }>()(
      persist(
        () => ({ count: 0 }),
        persistConfig<{ count: number }, { count: number }>({
          name,
          storage: {
            getItem: async (key) => {
              if (read.fails) throw new Error('Row too big to fit into CursorWindow');
              return disk.get(key) ?? null;
            },
            setItem: async (key, value) => void disk.set(key, value),
            removeItem: async (key) => void disk.delete(key),
          },
          schema: z.object({ count: z.number().int() }),
          partialize: (state) => ({ count: state.count }),
        })
      )
    );
  }

  it('reports a cut-short blob as unread, and leaves it on disk', async () => {
    const cut = '{"state":{"count":4';
    const disk = new Map([['outcome-real-cut', cut]]);
    const store = mount('outcome-real-cut', disk, { fails: false });
    await expect(hydrationSettled(store)).resolves.toBe(false);
    await expect(loadRequiredStores([store])).rejects.toThrow('outcome-real-cut');
    expect(disk.get('outcome-real-cut')).toBe(cut);
  });

  it('starts after a read that failed once succeeds on the retry', async () => {
    const disk = new Map([['outcome-real-flaky', '{"state":{"count":7},"version":1}']]);
    const read = { fails: true };
    const store = mount('outcome-real-flaky', disk, read);
    await expect(loadRequiredStores([store])).rejects.toThrow('outcome-real-flaky');

    read.fails = false;
    await expect(loadRequiredStores([store])).resolves.toBeUndefined();
    expect(store.getState().count).toBe(7);
  });
});
