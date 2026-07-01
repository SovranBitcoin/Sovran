import { SerializedClientState } from "../../core/client-state.js";
import { KeyValueStoreBackend } from "../../utils/key-value.js";
import { GroupStateStoreBackend } from "../group-state-store.js";
/**
 * Adapter to convert a KeyValueStoreBackend<string, SerializedClientState> to GroupStateStoreBackend.
 * This is useful for migrating existing backends that use string keys.
 */
export declare class KeyValueGroupStateBackend implements GroupStateStoreBackend {
    private backend;
    constructor(backend: KeyValueStoreBackend<SerializedClientState>);
    get(groupId: Uint8Array): Promise<SerializedClientState | null>;
    set(groupId: Uint8Array, stateBytes: SerializedClientState): Promise<void>;
    remove(groupId: Uint8Array): Promise<void>;
    list(): Promise<Uint8Array[]>;
}
