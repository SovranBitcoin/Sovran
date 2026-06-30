import { NostrEvent } from "applesauce-core/helpers/event";
import { EventEmitter } from "eventemitter3";
import { CryptoProvider } from "ts-mls";
import { KeyPackage, PrivateKeyPackage } from "ts-mls/keyPackage.js";
import { KeyValueStoreBackend } from "../utils/key-value.js";
/**
 * A key package that has local private material.
 *
 * Created by {@link KeyPackageStore.add} when generating or importing a key
 * package for which the private keys are held locally. Narrow from
 * {@link StoredKeyPackage} by checking `privatePackage !== undefined`.
 */
export type LocalKeyPackage = {
    /** The calculated key package reference */
    keyPackageRef: Uint8Array;
    /** The public key package */
    publicPackage: KeyPackage;
    /** The private key package — its presence is the discriminant for a local entry */
    privatePackage: PrivateKeyPackage;
    /** Nostr kind-443 events this key package has been published under */
    published?: NostrEvent[];
    /** Whether this key package has been consumed (e.g. used to join a group). Undefined means unused. */
    used?: boolean;
};
/**
 * A key package observed on relays for which no private material is held locally.
 *
 * Created by {@link KeyPackageStore.addPublished} when tracking a kind-443 event
 * from another device. Enables cross-device deletion without requiring the
 * private keys to be present. The public key package is always present — events
 * that cannot be decoded are rejected as invalid.
 *
 * Narrow from {@link StoredKeyPackage} by checking `privatePackage === undefined`.
 */
export type TrackedKeyPackage = {
    /** The calculated key package reference */
    keyPackageRef: Uint8Array;
    /** The public key package, decoded from the kind-443 event body */
    publicPackage: KeyPackage;
    /** Always undefined — the discriminant that identifies this as a tracked entry */
    privatePackage?: undefined;
    /** Nostr kind-443 events this key package has been published under */
    published?: NostrEvent[];
    /** Whether this key package has been consumed (e.g. used to join a group). Undefined means unused. */
    used?: boolean;
};
/**
 * A stored key package — either a locally-held one (with private material) or
 * a tracked foreign one (without private material).
 *
 * Use `privatePackage` to narrow the type:
 *
 * ```ts
 * if (pkg.privatePackage !== undefined) {
 *   // pkg is LocalKeyPackage
 * } else {
 *   // pkg is TrackedKeyPackage
 * }
 * ```
 */
export type StoredKeyPackage = LocalKeyPackage | TrackedKeyPackage;
/** A {@link LocalKeyPackage} without the private material, safe to expose in listings */
export type ListedKeyPackage = Omit<StoredKeyPackage, "privatePackage">;
/** Backend interface for the key package store */
export interface KeyPackageStoreBackend extends KeyValueStoreBackend<StoredKeyPackage> {
}
/** Options for creating a {@link KeyPackageStore} instance */
export type KeyPackageStoreOptions = {
    /** The crypto provider to use for cryptographic operations */
    cryptoProvider?: CryptoProvider;
};
type KeyPackageStoreEvents = {
    /** Emitted when a key package is added or first tracked */
    keyPackageAdded: (keyPackage: StoredKeyPackage) => void;
    /** Emitted when a key package is removed */
    keyPackageRemoved: (keyPackageRef: Uint8Array) => void;
    /** Emitted when a key package is updated (publish event added) */
    keyPackageUpdated: (keyPackage: StoredKeyPackage) => void;
};
/**
 * Stores key packages in a {@link KeyPackageStoreBackend}.
 *
 * Two kinds of entries coexist in the same backend:
 * - {@link LocalKeyPackage} — has private material; created by {@link add}
 * - {@link TrackedKeyPackage} — no private material; created by {@link addPublished}
 *   for key packages observed on relays from other devices
 *
 * {@link list} and {@link has} only surface local key packages; use
 * {@link getKeyPackage} to retrieve any entry regardless of type.
 *
 * @example
 * ```typescript
 * const store = new KeyPackageStore(backend);
 *
 * // Add a key package with local private material
 * await store.add({ publicPackage, privatePackage });
 * // List all key packages that have local private material
 * const packages = await store.list();
 * // Get any entry by ref (local or tracked)
 * const entry = await store.getKeyPackage(ref);
 * if (entry?.privatePackage !== undefined) { /* LocalKeyPackage *\/ }
 * // Track a published kind-443 event from another device
 * await store.addPublished(refHex, nostrEvent);
 * ```
 */
export declare class KeyPackageStore extends EventEmitter<KeyPackageStoreEvents> {
    #private;
    private backend;
    private readonly cryptoProvider;
    /**
     * Creates a new KeyPackageStore instance.
     * @param backend - The storage backend to use (e.g., localForage)
     * @param options - Options for the store
     */
    constructor(backend: KeyPackageStoreBackend, { cryptoProvider }?: KeyPackageStoreOptions);
    /** Resolves a ref/package argument to a hex storage key */
    private resolveStorageKey;
    /**
     * Adds a {@link LocalKeyPackage} to the store.
     *
     * Use this for locally-generated key packages where the private material is
     * available. For foreign-device publish tracking use {@link addPublished}.
     *
     * @param keyPackage - Must include `publicPackage` and `privatePackage`.
     *   `keyPackageRef` is computed automatically.
     * @returns The storage key (hex ref string)
     */
    add(keyPackage: Pick<LocalKeyPackage, "publicPackage" | "privatePackage"> & Partial<Pick<LocalKeyPackage, "published">>): Promise<string>;
    /**
     * Appends a kind-443 Nostr event to the `published` list of the key package
     * identified by `ref`. If no entry exists yet, a {@link TrackedKeyPackage} is
     * created by decoding the public key package from the event body.
     *
     * Throws if the event body cannot be decoded as a valid key package — callers
     * should validate events before calling this method (or use
     * {@link KeyPackageManager.track} which catches decode errors automatically).
     *
     * @param ref - The key package reference hex string (from the event's `i` tag)
     * @param event - The signed kind-443 Nostr event to record
     * @throws If no entry exists and the event body cannot be decoded as a KeyPackage
     */
    addPublished(ref: string | Uint8Array, event: NostrEvent): Promise<void>;
    /**
     * Retrieves only the public key package from the store.
     *
     * @param ref - The key package reference (as Uint8Array, hex string, or KeyPackage)
     * @returns The public key package, or null if not found
     */
    getPublicKey(ref: Uint8Array | string | KeyPackage): Promise<KeyPackage | null>;
    /**
     * Retrieves only the private key package from the store.
     *
     * Returns null for {@link TrackedKeyPackage} entries (no private material).
     * Be cautious about keeping private keys in memory longer than necessary.
     *
     * @param ref - The key package reference (as Uint8Array, hex string, or KeyPackage)
     * @returns The private key package, or null if not found or if the entry is tracked-only
     */
    getPrivateKey(ref: Uint8Array | string | KeyPackage): Promise<PrivateKeyPackage | null>;
    /**
     * Retrieves the stored key package entry from the store.
     *
     * Returns any entry regardless of whether it has private material.
     * Check `privatePackage !== undefined` to narrow to a {@link LocalKeyPackage}.
     *
     * @param ref - The key package reference (as Uint8Array, hex string, or KeyPackage)
     * @returns The stored entry, or null if not found
     */
    getKeyPackage(ref: Uint8Array | string | KeyPackage): Promise<StoredKeyPackage | null>;
    /**
     * Removes a key package from the store (local or tracked).
     * @param ref - The key package reference (as Uint8Array, hex string, or KeyPackage)
     */
    remove(ref: Uint8Array | string | KeyPackage): Promise<void>;
    /**
     * Lists all {@link LocalKeyPackage} entries (those with private material),
     * without the private package itself.
     *
     * {@link TrackedKeyPackage} entries are excluded — use {@link getKeyPackage}
     * to retrieve a specific tracked entry by ref.
     */
    list(): Promise<ListedKeyPackage[]>;
    /** Gets the count of {@link LocalKeyPackage} entries (those with private material). */
    count(): Promise<number>;
    /** Clears all entries (local and tracked) from the store. */
    clear(): Promise<void>;
    /**
     * Returns `true` only if a {@link LocalKeyPackage} (with private material)
     * exists for the given ref. Returns `false` for {@link TrackedKeyPackage} entries.
     *
     * @param ref - The key package reference (as Uint8Array, hex string, or KeyPackage)
     */
    has(ref: Uint8Array | string | KeyPackage): Promise<boolean>;
    /**
     * Marks a stored key package as used by setting `used = true` and persisting the update.
     *
     * Emits `keyPackageUpdated`. This flag allows applications to distinguish consumed
     * key packages (e.g. used to join a group) from fresh ones, and to periodically
     * rotate or clean up used packages.
     *
     * Does nothing if no entry exists for the given ref.
     *
     * @param ref - The key package reference (as Uint8Array, hex string, or KeyPackage)
     */
    markUsed(ref: Uint8Array | string | KeyPackage): Promise<void>;
}
export {};
