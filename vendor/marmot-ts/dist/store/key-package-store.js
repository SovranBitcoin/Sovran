import { bytesToHex } from "@noble/hashes/utils.js";
import { EventEmitter } from "eventemitter3";
import { defaultCryptoProvider } from "ts-mls";
import { getKeyPackage } from "../core/key-package-event.js";
import { calculateKeyPackageRef } from "../core/key-package.js";
import { logger } from "../utils/debug.js";
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
export class KeyPackageStore extends EventEmitter {
    backend;
    cryptoProvider;
    #log = logger.extend("KeyPackageStore");
    /**
     * Creates a new KeyPackageStore instance.
     * @param backend - The storage backend to use (e.g., localForage)
     * @param options - Options for the store
     */
    constructor(backend, { cryptoProvider } = {}) {
        super();
        this.backend = backend;
        this.cryptoProvider = cryptoProvider ?? defaultCryptoProvider;
    }
    /** Resolves a ref/package argument to a hex storage key */
    async resolveStorageKey(hashOrPackage) {
        if (typeof hashOrPackage === "string")
            return hashOrPackage;
        if (hashOrPackage instanceof Uint8Array)
            return bytesToHex(hashOrPackage);
        return bytesToHex(await calculateKeyPackageRef(hashOrPackage, this.cryptoProvider));
    }
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
    async add(keyPackage) {
        const key = await this.resolveStorageKey(keyPackage.publicPackage);
        const keyPackageRef = await calculateKeyPackageRef(keyPackage.publicPackage, this.cryptoProvider);
        const entry = {
            keyPackageRef,
            publicPackage: keyPackage.publicPackage,
            privatePackage: keyPackage.privatePackage,
            ...(keyPackage.published !== undefined
                ? { published: keyPackage.published }
                : {}),
        };
        await this.backend.setItem(key, entry);
        this.emit("keyPackageAdded", entry);
        this.#log("added %s" + (entry.privatePackage ? " with private key" : ""), key);
        return key;
    }
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
    async addPublished(ref, event) {
        const key = typeof ref === "string" ? ref : bytesToHex(ref);
        const existing = await this.backend.getItem(key);
        if (existing) {
            // Skip if event is already in array
            if (existing.published?.some((e) => e.id === event.id))
                return;
            const updated = {
                ...existing,
                published: [...(existing.published ?? []), event],
            };
            await this.backend.setItem(key, updated);
            this.emit("keyPackageUpdated", updated);
            this.#log("stored published event %s for %s", event.id, ref);
        }
        else {
            // No local entry — decode the public key package from the event body.
            // Throws if the event content is not a valid encoded KeyPackage.
            const publicPackage = getKeyPackage(event);
            const keyPackageRef = await calculateKeyPackageRef(publicPackage, this.cryptoProvider);
            const entry = {
                keyPackageRef,
                publicPackage,
                published: [event],
            };
            await this.backend.setItem(key, entry);
            this.emit("keyPackageAdded", entry);
            this.#log("added key package from event %s", event.id);
        }
    }
    /**
     * Retrieves only the public key package from the store.
     *
     * @param ref - The key package reference (as Uint8Array, hex string, or KeyPackage)
     * @returns The public key package, or null if not found
     */
    async getPublicKey(ref) {
        const key = await this.resolveStorageKey(ref);
        const stored = await this.backend.getItem(key);
        return stored?.publicPackage ?? null;
    }
    /**
     * Retrieves only the private key package from the store.
     *
     * Returns null for {@link TrackedKeyPackage} entries (no private material).
     * Be cautious about keeping private keys in memory longer than necessary.
     *
     * @param ref - The key package reference (as Uint8Array, hex string, or KeyPackage)
     * @returns The private key package, or null if not found or if the entry is tracked-only
     */
    async getPrivateKey(ref) {
        const key = await this.resolveStorageKey(ref);
        const stored = await this.backend.getItem(key);
        return stored?.privatePackage ?? null;
    }
    /**
     * Retrieves the stored key package entry from the store.
     *
     * Returns any entry regardless of whether it has private material.
     * Check `privatePackage !== undefined` to narrow to a {@link LocalKeyPackage}.
     *
     * @param ref - The key package reference (as Uint8Array, hex string, or KeyPackage)
     * @returns The stored entry, or null if not found
     */
    async getKeyPackage(ref) {
        const key = await this.resolveStorageKey(ref);
        return this.backend.getItem(key);
    }
    /**
     * Removes a key package from the store (local or tracked).
     * @param ref - The key package reference (as Uint8Array, hex string, or KeyPackage)
     */
    async remove(ref) {
        const key = await this.resolveStorageKey(ref);
        const stored = await this.backend.getItem(key);
        await this.backend.removeItem(key);
        if (stored) {
            this.emit("keyPackageRemoved", stored.keyPackageRef);
            this.#log("removed key package %s", key);
        }
    }
    /**
     * Lists all {@link LocalKeyPackage} entries (those with private material),
     * without the private package itself.
     *
     * {@link TrackedKeyPackage} entries are excluded — use {@link getKeyPackage}
     * to retrieve a specific tracked entry by ref.
     */
    async list() {
        const allKeys = await this.backend.keys();
        const packages = await Promise.all(allKeys.map((key) => this.backend.getItem(key)));
        return packages
            .filter((pkg) => pkg !== null && pkg.privatePackage !== undefined)
            .map(({ keyPackageRef, publicPackage, published, used }) => ({
            keyPackageRef,
            publicPackage,
            ...(published !== undefined ? { published } : {}),
            ...(used !== undefined ? { used } : {}),
        }));
    }
    /** Gets the count of {@link LocalKeyPackage} entries (those with private material). */
    async count() {
        return (await this.list()).length;
    }
    /** Clears all entries (local and tracked) from the store. */
    async clear() {
        const allKeys = await this.backend.keys();
        for (const key of allKeys) {
            const stored = await this.backend.getItem(key);
            await this.backend.removeItem(key);
            if (stored) {
                this.emit("keyPackageRemoved", stored.keyPackageRef);
            }
        }
    }
    /**
     * Returns `true` only if a {@link LocalKeyPackage} (with private material)
     * exists for the given ref. Returns `false` for {@link TrackedKeyPackage} entries.
     *
     * @param ref - The key package reference (as Uint8Array, hex string, or KeyPackage)
     */
    async has(ref) {
        const key = await this.resolveStorageKey(ref);
        const item = await this.backend.getItem(key);
        return item !== null && item.privatePackage !== undefined;
    }
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
    async markUsed(ref) {
        const key = await this.resolveStorageKey(ref);
        const existing = await this.backend.getItem(key);
        if (!existing)
            return;
        const updated = { ...existing, used: true };
        await this.backend.setItem(key, updated);
        this.emit("keyPackageUpdated", updated);
        this.#log("marked key package %s as used", key);
    }
}
//# sourceMappingURL=key-package-store.js.map