/**
 * Wipe a persisted Zustand store: replace the persisted state slice with
 * `initialState`, then remove the persisted key from storage.
 *
 * The order matters. A trailing `set(...)` always triggers persist
 * middleware to write the partialized envelope back to storage, so doing
 * `removeItem` first and `set` second leaves the storage key repopulated
 * with the new state — and any concurrent `set(...)` racing inside the
 * `await` window of the `removeItem` would land in storage too. Doing
 * `set` first means the persist write of `initialState` is enqueued
 * before `clearStorage` calls the storage adapter's `removeItem`; with
 * an adapter that serializes per-key writes (RN AsyncStorage does), the
 * key ends up gone and the next launch rehydrates from defaults.
 *
 * `clearStorage` resolves the storage key the same way the persist
 * middleware does (via the `name` it was configured with), so this works
 * for both raw `AsyncStorage` and the profile-scoped adapter without the
 * call site having to know the key shape.
 *
 * Throws if the storage adapter rejects; call sites that previously
 * swallowed the error keep their try/catch.
 */
export async function clearPersistedStore<T extends object>(
  store: {
    setState: (state: Partial<T>) => void;
    persist: { clearStorage: () => Promise<void> | void };
  },
  initialState: Partial<T>
): Promise<void> {
  store.setState(initialState);
  await Promise.resolve(store.persist.clearStorage());
}
