let _skipPersistWrite = false;
let switchWritesBlocked = false;
const pendingWrites = new Set<Promise<unknown>>();

/** Remains raised on failure until the runtime restarts. */
export async function blockProfilePersistWrites(): Promise<void> {
  switchWritesBlocked = true;
  await Promise.all([...pendingWrites]);
}

/** Includes adapters with secure-storage work before their AsyncStorage write. */
export function profilePersistWrite(operation: () => unknown): Promise<void> {
  if (_skipPersistWrite || switchWritesBlocked) return Promise.resolve();
  const write = Promise.resolve(operation()).then(() => {});
  pendingWrites.add(write);
  void write.then(
    () => pendingWrites.delete(write),
    () => pendingWrites.delete(write)
  );
  return write;
}

export function unblockProfilePersistWrites(): void {
  switchWritesBlocked = false;
}

/**
 * Run `fn` with the persist-write gate raised. Synchronous: mutations queued
 * inside `fn` (`useStore.setState(...)`) bypass AsyncStorage; afterwards the
 * gate drops and normal persistence resumes. Use for runtime-only injections
 * into persisted profile-scoped stores.
 */
export function withSkippedPersistWrites<T>(fn: () => T): T {
  const prev = _skipPersistWrite;
  _skipPersistWrite = true;
  try {
    return fn();
  } finally {
    _skipPersistWrite = prev;
  }
}

export function profilePersistWritesBlocked(): boolean {
  return _skipPersistWrite || switchWritesBlocked;
}

export function trackProfilePersistWrite<T>(write: Promise<T>): Promise<T> {
  pendingWrites.add(write);
  void write.then(
    () => pendingWrites.delete(write),
    () => pendingWrites.delete(write)
  );
  return write;
}
