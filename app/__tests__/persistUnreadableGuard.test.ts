/** @jest-environment node */
import { z } from 'zod';
import { create } from 'zustand';
import { persist, type StateStorage } from 'zustand/middleware';

import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));

/**
 * A store that cannot load its blob runs on defaults, and its next write used
 * to replace the blob. These hold the two rules that stop that: a blob that
 * was read is copied aside before it is overwritten, and a blob that could not
 * be read is never overwritten.
 */
type Disk = Map<string, string>;
const NAME = 'guard-test-store';
const SIDE = `${NAME}:unreadable`;

function memoryStorage(disk: Disk, overrides: Partial<StateStorage> = {}): StateStorage {
  return {
    getItem: async (key) => disk.get(key) ?? null,
    setItem: async (key, value) => void disk.set(key, value),
    removeItem: async (key) => void disk.delete(key),
    ...overrides,
  };
}

interface State {
  count: number;
  bump: () => void;
}

let serial = 0;
/** Build the store and wait for its hydration to settle. */
async function mount(
  storage: StateStorage,
  options: {
    version?: number;
    migrate?: (state: unknown, version: number) => { count: number };
    preserveUnreadable?: boolean;
  } = {}
) {
  serial += 1;
  const store = create<State>()(
    persist(
      (set) => ({ count: 0, bump: () => set((state) => ({ count: state.count + 1 })) }),
      persistConfig<State, { count: number }>({
        name: NAME,
        // The registry is keyed by name; each mount needs its own entry.
        logKey: `guard_test_${serial}`,
        storage,
        schema: z.object({ count: z.number().int() }),
        partialize: (state) => ({ count: state.count }),
        ...options,
      })
    )
  );
  await settle();
  return store;
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};
const blob = (state: unknown, version = 1) => JSON.stringify({ state, version });

it('saves normally when the blob loads', async () => {
  const disk: Disk = new Map([[NAME, blob({ count: 4 })]]);
  const store = await mount(memoryStorage(disk));

  expect(store.getState().count).toBe(4);
  store.getState().bump();
  await settle();

  expect(JSON.parse(disk.get(NAME)!).state.count).toBe(5);
  expect(disk.has(SIDE)).toBe(false);
});

it('saves normally on a fresh install', async () => {
  const disk: Disk = new Map();
  const store = await mount(memoryStorage(disk));

  store.getState().bump();
  await settle();

  expect(JSON.parse(disk.get(NAME)!).state.count).toBe(1);
  expect(disk.has(SIDE)).toBe(false);
});

it('copies a blob the schema rejects before overwriting it', async () => {
  const original = blob({ count: 'seven', somethingNewer: true });
  const disk: Disk = new Map([[NAME, original]]);
  const store = await mount(memoryStorage(disk));

  expect(store.getState().count).toBe(0);
  store.getState().bump();
  await settle();

  expect(disk.get(SIDE)).toBe(original);
  expect(JSON.parse(disk.get(NAME)!).state.count).toBe(1);
});

it('copies a blob that is not JSON', async () => {
  const disk: Disk = new Map([[NAME, '{"state":{"count":3'] as [string, string]]);
  const store = await mount(memoryStorage(disk));

  store.getState().bump();
  await settle();

  expect(disk.get(SIDE)).toBe('{"state":{"count":3');
  expect(JSON.parse(disk.get(NAME)!).state.count).toBe(1);
});

it('copies the original bytes when migrate throws', async () => {
  const original = blob({ legacy: 12 }, 1);
  const disk: Disk = new Map([[NAME, original]]);
  const store = await mount(memoryStorage(disk), {
    version: 2,
    migrate: () => {
      throw new Error('cannot migrate');
    },
  });

  store.getState().bump();
  await settle();

  expect(disk.get(SIDE)).toBe(original);
});

it('copies the original bytes, not the migrated ones, when the migrated blob is rejected', async () => {
  // Zustand persists straight after a migration. That write used to replace
  // the old blob with defaults before anything else could run.
  const original = blob({ legacy: 12 }, 1);
  const disk: Disk = new Map([[NAME, original]]);
  await mount(memoryStorage(disk), {
    version: 2,
    migrate: () => ({ count: 'not a number' }) as unknown as { count: number },
  });

  expect(disk.get(SIDE)).toBe(original);
  expect(JSON.parse(disk.get(NAME)!).state.count).toBe(0);
});

it('keeps the first copy when the store fails to load again', async () => {
  const disk: Disk = new Map([
    [NAME, blob({ count: 'second failure' })],
    [SIDE, 'the first unreadable blob'],
  ]);
  const store = await mount(memoryStorage(disk));

  store.getState().bump();
  await settle();

  expect(disk.get(SIDE)).toBe('the first unreadable blob');
  expect(JSON.parse(disk.get(NAME)!).state.count).toBe(1);
});

it('never overwrites a blob it could not read', async () => {
  const original = blob({ count: 9 });
  const disk: Disk = new Map([[NAME, original]]);
  const store = await mount(
    memoryStorage(disk, {
      getItem: async () => {
        throw new Error('row too big');
      },
    })
  );

  store.getState().bump();
  store.getState().bump();
  await settle();

  // In memory the store works; on disk nothing was replaced.
  expect(store.getState().count).toBe(2);
  expect(disk.get(NAME)).toBe(original);
  expect(disk.has(SIDE)).toBe(false);
});

it('refuses the overwrite when the copy cannot be written', async () => {
  const original = blob({ count: 'seven' });
  const disk: Disk = new Map([[NAME, original]]);
  const store = await mount(
    memoryStorage(disk, {
      setItem: async (key, value) => {
        if (key === SIDE) throw new Error('disk full');
        disk.set(key, value);
      },
    })
  );

  store.getState().bump();
  await settle();

  expect(disk.get(NAME)).toBe(original);
});

it('refuses the overwrite when the copy is dropped without an error', async () => {
  // The profile write barrier resolves without writing.
  const original = blob({ count: 'seven' });
  const disk: Disk = new Map([[NAME, original]]);
  const store = await mount(
    memoryStorage(disk, {
      setItem: async (key, value) => {
        if (key !== SIDE) disk.set(key, value);
      },
    })
  );

  store.getState().bump();
  await settle();

  expect(disk.get(NAME)).toBe(original);
});

it('tries the copy again on the next write, then saves', async () => {
  // A copy dropped once (the write barrier during a switch, a passing storage
  // error) must not leave the store unable to save for the rest of the session.
  const original = blob({ count: 'seven' });
  const disk: Disk = new Map([[NAME, original]]);
  let blocked = true;
  const store = await mount(
    memoryStorage(disk, {
      setItem: async (key, value) => {
        if (!blocked) disk.set(key, value);
      },
    })
  );
  store.getState().bump();
  await settle();
  expect(disk.get(NAME)).toBe(original);

  blocked = false;
  store.getState().bump();
  await settle();

  expect(disk.get(SIDE)).toBe(original);
  expect(JSON.parse(disk.get(NAME)!).state.count).toBe(2);
});

it('writes again once a later load succeeds', async () => {
  const disk: Disk = new Map([[NAME, blob({ count: 9 })]]);
  let failing = true;
  const store = await mount(
    memoryStorage(disk, {
      getItem: async (key) => {
        if (failing) throw new Error('storage unavailable');
        return disk.get(key) ?? null;
      },
    })
  );
  store.getState().bump();
  await settle();
  expect(JSON.parse(disk.get(NAME)!).state.count).toBe(9);

  failing = false;
  await store.persist.rehydrate();
  await settle();
  expect(store.getState().count).toBe(9);
  store.getState().bump();
  await settle();

  expect(JSON.parse(disk.get(NAME)!).state.count).toBe(10);
});

it('leaves a store that opted out exactly as before', async () => {
  const disk: Disk = new Map([[NAME, blob({ count: 'seven' })]]);
  const store = await mount(memoryStorage(disk), { preserveUnreadable: false });

  store.getState().bump();
  await settle();

  expect(disk.has(SIDE)).toBe(false);
  expect(JSON.parse(disk.get(NAME)!).state.count).toBe(1);
});

it('logs a save that storage rejects, once, and still reports the failure', async () => {
  // On Android a full database fails every save. Ordinary saves ignore the
  // result, so the log is the only trace; callers that await a save (recovery,
  // the save after a migration) still need it to throw.
  const disk: Disk = new Map();
  let full = false;
  const store = await mount(
    memoryStorage(disk, {
      setItem: async (key, value) => {
        if (full) throw new Error('database or disk is full');
        disk.set(key, value);
      },
    })
  );
  full = true;
  jest.mocked(storeLog.error).mockClear();
  const storage = store.persist.getOptions().storage!;
  const value = { state: { count: 1 }, version: 1 };

  await expect(storage.setItem(NAME, value)).rejects.toThrow('database or disk is full');
  await expect(storage.setItem(NAME, value)).rejects.toThrow('database or disk is full');

  const failures = jest
    .mocked(storeLog.error)
    .mock.calls.filter(([event]) => String(event).endsWith('.save_failed'));
  expect(failures).toHaveLength(1);
});
