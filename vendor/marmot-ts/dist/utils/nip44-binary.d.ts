/**
 * NIP-44 v2 encryption with binary (Uint8Array) plaintext support.
 *
 * Functionally identical to NIP-44 v2 but the pad/unpad layer operates on raw
 * bytes instead of UTF-8 strings, removing the need to hex/base64-encode
 * binary payloads (e.g. TLS-serialized MLSMessages) before encryption.
 *
 * The wire format and conversation-key derivation are 100% compatible with
 * standard NIP-44 v2 – only the plaintext interpretation differs.
 */
/**
 * Derives a NIP-44 v2 conversation key from a secp256k1 private key and
 * the hex-encoded x-only public key of the other party.
 */
export declare function getConversationKey(privkeyA: Uint8Array, pubkeyB: string): Uint8Array;
/**
 * Encrypts a raw byte array using NIP-44 v2.
 *
 * @param plaintext - The binary data to encrypt
 * @param conversationKey - 32-byte conversation key (from {@link getConversationKey})
 * @param nonce - Optional 32-byte nonce (randomly generated if omitted)
 * @returns Base64-encoded NIP-44 v2 payload
 */
export declare function encryptBytes(plaintext: Uint8Array, conversationKey: Uint8Array, nonce?: Uint8Array): string;
/**
 * Decrypts a NIP-44 v2 payload back to raw bytes.
 *
 * @param payload - Base64-encoded NIP-44 v2 payload
 * @param conversationKey - 32-byte conversation key (from {@link getConversationKey})
 * @returns The decrypted binary data
 */
export declare function decryptBytes(payload: string, conversationKey: Uint8Array): Uint8Array;
