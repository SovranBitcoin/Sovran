type ClosableDatabase = { closeAsync(): Promise<void> };

// Complete operations used by coco-expo-sqlite. Raw prepared statements and
// streaming iterators have a different lifetime and are not this adapter's API.
const COCO_ASYNC_METHODS = new Set<PropertyKey>([
  'execAsync',
  'runAsync',
  'getFirstAsync',
  'getAllAsync',
  'withTransactionAsync',
  'withExclusiveTransactionAsync',
]);

/** Coco uses Expo's complete async query helpers (prepare, execute, consume,
 * finalize). Keep those calls concurrent, but drain them before native close.
 * Also drain exclusive transaction scopes before Expo closes their temporary
 * connection, including when a callback rejects while another query is pending.
 * This does not change SQL, transaction ordering, or persisted data. */
export function drainSqlite<T extends ClosableDatabase>(database: T): T {
  return createLease(database).database;
}

function createLease<T extends ClosableDatabase>(database: T) {
  const pending = new Set<Promise<unknown>>();
  const methods = new Map<PropertyKey, unknown>();
  let accepting = true;
  let closing: Promise<void> | undefined;

  const drain = async () => {
    accepting = false;
    await Promise.allSettled([...pending]);
  };
  const close = () => {
    if (!closing) {
      closing = (async () => {
        await drain();
        await database.closeAsync();
      })();
    }
    return closing;
  };

  const proxy = new Proxy(database, {
    get(target, key) {
      if (key === 'closeAsync') return close;
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      if (methods.has(key)) return methods.get(key);
      const method = (...args: unknown[]) => {
        if (!accepting) {
          const error = new Error('SQLite connection is closing');
          if (String(key).endsWith('Async')) return Promise.reject(error);
          throw error;
        }
        if (!COCO_ASYNC_METHODS.has(key)) return Reflect.apply(value, target, args);
        let operation: Promise<unknown>;
        try {
          if (key === 'withExclusiveTransactionAsync') {
            const task = args[0] as (transaction: ClosableDatabase) => Promise<unknown>;
            operation = Reflect.apply(value, target, [
              async (transaction: ClosableDatabase) => {
                const scope = createLease(transaction);
                try {
                  return await task(scope.database);
                } finally {
                  await scope.drain();
                }
              },
            ]);
          } else {
            operation = Reflect.apply(value, target, args);
          }
        } catch (error) {
          return Promise.reject(error);
        }
        pending.add(operation);
        void operation.then(
          () => pending.delete(operation),
          () => pending.delete(operation)
        );
        return operation;
      };
      methods.set(key, method);
      return method;
    },
  });
  return { database: proxy, drain };
}
