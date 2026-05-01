import { EventEmitter } from "eventemitter3";
/**
 * A bytes-only store for MLS group state.
 *
 * This class manages the persistence of MLS group state as raw bytes.
 * It does NOT handle serialization/deserialization - that is the responsibility of the caller.
 *
 * This design ensures:
 * 1. Storage layer has no dependency on ClientConfig (policy concern)
 * 2. Storage is backend-neutral and portable
 * 3. Namespacing is handled by the backend instance, not the store
 */
export class GroupStateStore extends EventEmitter {
    backend;
    constructor(backend) {
        super();
        this.backend = backend;
    }
    /**
     * Retrieves the serialized state bytes from storage.
     *
     * @param groupId - The group ID
     * @returns A promise that resolves to the serialized state bytes, or null if not found
     */
    async get(groupId) {
        return this.backend.get(groupId);
    }
    /**
     * Stores serialized state bytes.
     *
     * This is effectively an upsert: if a group with the same ID already
     * exists, it will be overwritten; otherwise, it will be created.
     *
     * @param groupId - The group ID
     * @param stateBytes - The serialized state bytes to store
     */
    async set(groupId, stateBytes) {
        const exists = await this.backend.get(groupId);
        await this.backend.set(groupId, stateBytes);
        if (exists) {
            this.emit("groupStateUpdated", groupId, stateBytes);
        }
        else {
            this.emit("groupStateAdded", groupId, stateBytes);
        }
    }
    /**
     * Removes a group from the store.
     * @param groupId - The group ID
     */
    async remove(groupId) {
        await this.backend.remove(groupId);
        this.emit("groupStateRemoved", groupId);
    }
    /**
     * Lists all stored group IDs.
     * @returns An array of group IDs
     */
    async list() {
        return this.backend.list();
    }
    /**
     * Checks if a group exists in the store.
     * @param groupId - The group ID
     */
    async has(groupId) {
        const item = await this.backend.get(groupId);
        return item !== null;
    }
}
//# sourceMappingURL=group-state-store.js.map