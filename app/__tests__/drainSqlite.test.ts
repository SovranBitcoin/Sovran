/** @jest-environment node */
import { drainSqlite } from '@/shared/lib/cashu/drainSqlite';
import { ExpoSqliteRepositories } from '@cashu/coco-expo-sqlite';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const read = deferred<string[]>();
  const native = {
    getAllAsync: jest.fn(() => read.promise),
    execAsync: jest.fn(async () => {}),
    closeAsync: jest.fn(async () => {}),
  };
  return { read, native, db: drainSqlite(native) };
}

it('keeps the native connection open until an active read finishes', async () => {
  const { db, native, read } = fixture();
  const result = db.getAllAsync();
  const close = db.closeAsync();
  await Promise.resolve();
  expect(native.closeAsync).not.toHaveBeenCalled();
  read.resolve(['fixture']);
  await expect(result).resolves.toEqual(['fixture']);
  await close;
  expect(native.closeAsync).toHaveBeenCalledTimes(1);
});

it('drains a real Coco repository read before manager teardown closes its database', async () => {
  const { db, native, read } = fixture();
  const repositories = new ExpoSqliteRepositories({ database: db as never });
  const proofs = repositories.proofRepository.getReadyProofs('https://mint.example');
  expect(native.getAllAsync).toHaveBeenCalledTimes(1);
  const close = db.closeAsync();
  await Promise.resolve();
  expect(native.closeAsync).not.toHaveBeenCalled();
  read.resolve([]);
  await expect(proofs).resolves.toEqual([]);
  await close;
  expect(native.closeAsync).toHaveBeenCalledTimes(1);
});

it('rejects new work once close starts and shares concurrent close calls', async () => {
  const { db, native, read } = fixture();
  const result = db.getAllAsync();
  const first = db.closeAsync();
  const second = db.closeAsync();
  await expect(db.execAsync()).rejects.toThrow('closing');
  expect(native.execAsync).not.toHaveBeenCalled();
  read.resolve([]);
  await Promise.all([result, first, second]);
  expect(native.closeAsync).toHaveBeenCalledTimes(1);
  await expect(db.getAllAsync()).rejects.toThrow('closing');
});

it('preserves query failures while still draining and closing', async () => {
  const { db, native, read } = fixture();
  const error = new Error('fixture query failed');
  const result = db.getAllAsync();
  const assertion = expect(result).rejects.toBe(error);
  const close = db.closeAsync();
  read.reject(error);
  await assertion;
  await close;
  expect(native.closeAsync).toHaveBeenCalledTimes(1);
});

it('does not serialize independent reads during ordinary use', async () => {
  const { db, native, read } = fixture();
  const first = db.getAllAsync();
  const second = db.getAllAsync();
  expect(native.getAllAsync).toHaveBeenCalledTimes(2);
  read.resolve(['fixture']);
  await expect(Promise.all([first, second])).resolves.toEqual([['fixture'], ['fixture']]);
});

it('lets an accepted exclusive transaction finish its remaining queries before root close', async () => {
  const child = fixture();
  const native = {
    closeAsync: jest.fn(async () => {}),
    withExclusiveTransactionAsync: async (task: (txn: typeof child.native) => Promise<void>) => {
      try {
        await task(child.native);
      } finally {
        await child.native.closeAsync();
      }
    },
  };
  const db = drainSqlite(native);
  const transaction = db.withExclusiveTransactionAsync(async (txn) => {
    await txn.getAllAsync();
    await txn.execAsync();
  });
  const close = db.closeAsync();
  await Promise.resolve();
  expect(native.closeAsync).not.toHaveBeenCalled();
  child.read.resolve([]);
  await Promise.all([transaction, close]);
  expect(child.native.execAsync).toHaveBeenCalledTimes(1);
  expect(child.native.closeAsync).toHaveBeenCalledTimes(1);
  expect(native.closeAsync).toHaveBeenCalledTimes(1);
});

it('propagates native close failure without retrying the same handle', async () => {
  const error = new Error('fixture close failure');
  const native = { closeAsync: jest.fn().mockRejectedValue(error) };
  const db = drainSqlite(native);
  await expect(db.closeAsync()).rejects.toBe(error);
  await expect(db.closeAsync()).rejects.toBe(error);
  expect(native.closeAsync).toHaveBeenCalledTimes(1);
});

it('drains an exclusive transaction before Expo closes its temporary connection on failure', async () => {
  const child = fixture();
  const error = new Error('fixture transaction failed');
  const native = {
    closeAsync: jest.fn(async () => {}),
    withExclusiveTransactionAsync: async (task: (txn: typeof child.native) => Promise<void>) => {
      try {
        await task(child.native);
      } finally {
        await child.native.closeAsync();
      }
    },
  };
  const db = drainSqlite(native);
  let activeRead!: Promise<string[]>;
  const transaction = db.withExclusiveTransactionAsync(async (txn) => {
    activeRead = txn.getAllAsync();
    throw error;
  });
  const assertion = expect(transaction).rejects.toBe(error);
  await Promise.resolve();
  await Promise.resolve();
  expect(child.native.closeAsync).not.toHaveBeenCalled();
  child.read.resolve([]);
  await activeRead;
  await assertion;
  expect(child.native.closeAsync).toHaveBeenCalledTimes(1);
});
