import { EventEmitter } from "eventemitter3";
import { ClientState } from "ts-mls/clientState.js";
import { SerializedClientState } from "../core/client-state.js";
import { KeyValueStoreBackend } from "../utils/key-value.js";
/** A generic interface for a client state store backend */
export interface GroupStoreBackend extends KeyValueStoreBackend<SerializedClientState> {
}
/** Options for creating a {@link GroupStore} instance */
export type GroupStoreOptions = {
    prefix?: string;
};
type GroupStoreEvents = {
    /** Emitted when a client state is added */
    clientStateAdded: (clientState: ClientState) => void;
    /** Emitted when a client state is updated */
    clientStateUpdated: (clientState: ClientState) => void;
    /** Emitted when a client state is removed */
    clientStateRemoved: (groupId: Uint8Array) => void;
};
/**
 * Stores {@link ClientState} objects in a {@link GroupStoreBackend}.
 *
 * This class manages the persistence of MLS groups, storing the serialized
 * ClientState internally but always returning deserialized ClientState objects.
 */
export declare class GroupStore extends EventEmitter<GroupStoreEvents> {
    private backend;
    private readonly prefix?;
    /**
     * Creates a new GroupStore instance.
     * @param backend - The storage backend to use (e.g., localForage)
     * @param options - Optional configuration (prefix for namespacing)
     */
    constructor(backend: GroupStoreBackend, { prefix }?: GroupStoreOptions);
    /**
     * Resolves the storage key from a group ID.
     * @param groupId - The group ID (as Uint8Array or hex string)
     */
    private resolveStorageKey;
    /**
     * Adds a ClientState to the store.
     *
     * @param clientState - The ClientState to store
     * @returns A promise that resolves to the storage key used
     */
    add(clientState: ClientState): Promise<string>;
    /**
     * Updates an existing ClientState in the store.
     *
     * This is effectively an upsert: if a group with the same ID already
     * exists, it will be overwritten; otherwise, it will be created.
     *
     * @param clientState - The updated ClientState to store
     * @returns A promise that resolves to the storage key used
     */
    update(clientState: ClientState): Promise<string>;
    /**
     * Retrieves the ClientState from storage.
     *
     * @param groupId - The group ID (as Uint8Array or hex string)
     * @returns A promise that resolves to the ClientState, or null if not found
     */
    get(groupId: Uint8Array | string): Promise<ClientState | null>;
    /**
     * Removes a group from the store.
     * @param groupId - The group ID (as Uint8Array or hex string)
     */
    remove(groupId: Uint8Array | string): Promise<void>;
    /**
     * Lists all stored ClientState objects.
     * @returns An array of ClientState objects
     */
    list(): Promise<ClientState[]>;
    /** Gets the count of groups stored. */
    count(): Promise<number>;
    /** Clears all groups from the store (only those matching the prefix if one is set). */
    clear(): Promise<void>;
    /**
     * Checks if a group exists in the store.
     * @param groupId - The group ID (as Uint8Array or hex string)
     */
    has(groupId: Uint8Array | string): Promise<boolean>;
}
export {};
