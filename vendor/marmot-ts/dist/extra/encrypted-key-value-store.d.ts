import { KeyValueStoreBackend } from "../utils/key-value.js";
/**
 * Wrapper around a {@link KeyValueStoreBackend} that encrypts and decrypts data using a password.
 * WARNING: THIS IS NOT SECURE AND SHOULD NOT BE USED IN PRODUCTION. IT IS ONLY FOR DEMONSTRATION PURPOSES.
 */
export declare class EncryptedKeyValueStore implements KeyValueStoreBackend<Uint8Array> {
    private database;
    private salt;
    private key;
    get unlocked(): boolean;
    constructor(database: KeyValueStoreBackend<Uint8Array>, salt: Uint8Array);
    private deriveKey;
    setItem(key: string, value: Uint8Array, encryptionKey?: Uint8Array<ArrayBufferLike> | null): Promise<Uint8Array>;
    getItem(key: string, encryptionKey?: Uint8Array<ArrayBufferLike> | null): Promise<Uint8Array | null>;
    removeItem(key: string): Promise<void>;
    keys(): Promise<string[]>;
    clear(): Promise<void>;
    /** Verify if a password can decrypt stored data */
    unlock(password: string, testKey?: string): Promise<boolean>;
}
