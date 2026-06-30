import { EventEmitter } from "eventemitter3";
import type { KeyValueStoreBackend } from "../../utils/key-value.js";
import type { MediaAttachment } from "../../core/media.js";
import type { BaseGroupMedia, StoredMedia } from "./marmot-group.js";
/** A generic interface for a group media backend */
export interface GroupMediaBackend extends KeyValueStoreBackend<StoredMedia> {
}
/** A map of events that can be emitted by a {@link GroupMediaStore} */
type GroupMediaStoreEvents = {
    /** Emitted when a blob is added to the cache for the first time */
    mediaAdded: (sha256Hex: string, entry: StoredMedia) => void;
    /** Emitted when a blob is removed from the cache */
    mediaRemoved: (sha256Hex: string) => void;
    /** Emitted when the entire cache is cleared */
    cleared: () => void;
};
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
export declare class GroupMediaStore extends EventEmitter<GroupMediaStoreEvents> implements BaseGroupMedia {
    private readonly backend;
    constructor(backend?: GroupMediaBackend);
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
    addMedia(sha256Hex: string, entry: StoredMedia): Promise<void>;
    /**
     * Retrieves the cached blob for the given plaintext SHA-256 hex key.
     * Returns `null` if the entry is not cached.
     *
     * @param sha256Hex - Hex-encoded SHA-256 of the plaintext blob
     */
    getMedia(sha256Hex: string): Promise<StoredMedia | null>;
    /**
     * Returns `true` if a cached entry exists for the given key.
     *
     * @param sha256Hex - Hex-encoded SHA-256 of the plaintext blob
     */
    hasMedia(sha256Hex: string): Promise<boolean>;
    /**
     * Removes the cached entry for the given key.
     * Emits `mediaRemoved` if an entry existed.
     *
     * @param sha256 - Hex-encoded SHA-256 of the plaintext blob
     */
    removeMedia(sha256: string): Promise<void>;
    /**
     * Returns all SHA-256 hex keys currently held in the cache.
     */
    listMedia(): Promise<MediaAttachment[]>;
    /**
     * Removes all entries from the cache.
     * Emits `cleared`.
     */
    clearMedia(): Promise<void>;
    /**
     * Async generator that yields the full list of {@link MediaAttachment}
     * entries whenever the store changes. The current snapshot is emitted
     * immediately on subscription, then again after every `mediaAdded`,
     * `mediaRemoved`, or `cleared` event.
     *
     * The generator runs until the caller breaks out of the loop or the
     * consuming iterator is garbage-collected (via the `finally` cleanup).
     */
    subscribe(): AsyncGenerator<MediaAttachment[]>;
}
export {};
