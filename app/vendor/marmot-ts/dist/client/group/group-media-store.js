import { EventEmitter } from "eventemitter3";
import { InMemoryKeyValueStore } from "../../extra/in-memory-key-value-store.js";
/**
 * A group-scoped cache of decrypted {@link StoredMedia} entries used by
 * {@link MarmotGroup} to avoid redundant MIP-04 key-derivation and
 * decryption on repeated reads of the same media attachment.
 *
 * The lookup key is the hex-encoded SHA-256 of the **plaintext** bytes,
 * matching the `sha256` / `x` field stored in the MIP-04 `imeta` tag.
 *
 * Emits events whenever the cache state changes, enabling reactive UIs to
 * update without polling.
 *
 * If no backend is provided a simple in-memory store is used, giving an
 * ephemeral in-process cache with no disk persistence.
 */
export class GroupMediaStore extends EventEmitter {
    backend;
    constructor(backend) {
        super();
        this.backend = backend ?? new InMemoryKeyValueStore();
    }
    /**
     * Adds a decrypted blob to the cache if it is not already present.
     *
     * Emits `mediaAdded` when a new entry is stored. If an entry for the given
     * key already exists the call is a no-op and no event is emitted.
     * The key is the hex-encoded SHA-256 of the plaintext.
     *
     * @param sha256Hex - Hex-encoded SHA-256 of the plaintext blob
     * @param entry - The plaintext data and its MIP-04 attachment metadata
     */
    async addMedia(sha256Hex, entry) {
        const existing = await this.backend.getItem(sha256Hex);
        if (existing)
            return;
        await this.backend.setItem(sha256Hex, entry);
        this.emit("mediaAdded", sha256Hex, entry);
    }
    /**
     * Retrieves the cached blob for the given plaintext SHA-256 hex key.
     * Returns `null` if the entry is not cached.
     *
     * @param sha256Hex - Hex-encoded SHA-256 of the plaintext blob
     */
    async getMedia(sha256Hex) {
        return this.backend.getItem(sha256Hex);
    }
    /**
     * Returns `true` if a cached entry exists for the given key.
     *
     * @param sha256Hex - Hex-encoded SHA-256 of the plaintext blob
     */
    async hasMedia(sha256Hex) {
        return (await this.backend.getItem(sha256Hex)) !== null;
    }
    /**
     * Removes the cached entry for the given key.
     * Emits `mediaRemoved` if an entry existed.
     *
     * @param sha256 - Hex-encoded SHA-256 of the plaintext blob
     */
    async removeMedia(sha256) {
        const existing = await this.backend.getItem(sha256);
        if (!existing)
            return;
        await this.backend.removeItem(sha256);
        this.emit("mediaRemoved", sha256);
    }
    /**
     * Returns all SHA-256 hex keys currently held in the cache.
     */
    async listMedia() {
        const keys = await this.backend.keys();
        const items = await Promise.all(keys.map((key) => this.backend.getItem(key).then((v) => v?.attachment ?? null)));
        return items.filter((v) => v !== null);
    }
    /**
     * Removes all entries from the cache.
     * Emits `cleared`.
     */
    async clearMedia() {
        await this.backend.clear();
        this.emit("cleared");
    }
    /**
     * Async generator that yields the full list of {@link MediaAttachment}
     * entries whenever the store changes. The current snapshot is emitted
     * immediately on subscription, then again after every `mediaAdded`,
     * `mediaRemoved`, or `cleared` event.
     *
     * The generator runs until the caller breaks out of the loop or the
     * consuming iterator is garbage-collected (via the `finally` cleanup).
     */
    async *subscribe() {
        let pending = false;
        let nextResolve = null;
        const notify = () => {
            if (nextResolve) {
                nextResolve();
                nextResolve = null;
            }
            else {
                pending = true;
            }
        };
        this.on("mediaAdded", notify);
        this.on("mediaRemoved", notify);
        this.on("cleared", notify);
        try {
            yield await this.listMedia();
            while (true) {
                if (!pending) {
                    await new Promise((r) => {
                        nextResolve = r;
                    });
                }
                pending = false;
                yield await this.listMedia();
            }
        }
        finally {
            this.off("mediaAdded", notify);
            this.off("mediaRemoved", notify);
            this.off("cleared", notify);
        }
    }
}
//# sourceMappingURL=group-media-store.js.map