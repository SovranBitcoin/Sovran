import type { KeyValueStoreBackend } from "../utils/key-value.js";
/**
 * A simple in-memory implementation of {@link KeyValueStoreBackend}.
 *
 * Data lives only for the lifetime of the process / page — nothing is written
 * to disk. Useful as a default ephemeral backend when persistence is not
 * required or as a drop-in for testing.
 *
 * @template T - The type of values stored in this backend
 *
 * @example
 * ```ts
 * import { InMemoryKeyValueStore } from "@internet-privacy/marmot-ts/extra";
 *
 * const store = new InMemoryKeyValueStore<MyRecord>();
 * await store.setItem("key", { foo: "bar" });
 * const value = await store.getItem("key"); // { foo: "bar" }
 * ```
 */
export declare class InMemoryKeyValueStore<T> implements KeyValueStoreBackend<T> {
    private readonly store;
    getItem(key: string): Promise<T | null>;
    setItem(key: string, value: T): Promise<T>;
    removeItem(key: string): Promise<void>;
    clear(): Promise<void>;
    keys(): Promise<string[]>;
}
