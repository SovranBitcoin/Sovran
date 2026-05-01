import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
/**
 * Adapter to convert a KeyValueStoreBackend<string, SerializedClientState> to GroupStateStoreBackend.
 * This is useful for migrating existing backends that use string keys.
 */
export class KeyValueGroupStateBackend {
    backend;
    constructor(backend) {
        this.backend = backend;
    }
    async get(groupId) {
        const key = bytesToHex(groupId);
        return this.backend.getItem(key);
    }
    async set(groupId, stateBytes) {
        const key = bytesToHex(groupId);
        await this.backend.setItem(key, stateBytes);
    }
    async remove(groupId) {
        const key = bytesToHex(groupId);
        await this.backend.removeItem(key);
    }
    async list() {
        const keys = await this.backend.keys();
        return keys.map((key) => hexToBytes(key));
    }
}
//# sourceMappingURL=key-value-group-state-backend.js.map