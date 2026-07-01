import { ClientState } from "ts-mls/clientState.js";
import { CiphersuiteImpl } from "ts-mls/crypto/ciphersuite.js";
import { type MlsMessage } from "ts-mls/message.js";
/**
 * Emits a one-time warning when legacy MIP-03 group-message decryption is used.
 */
export declare function warnLegacyGroupMessageUsed(): void;
/**
 * Decrypts the legacy kind-445 content envelope and decodes an MLSMessage.
 *
 * This compatibility path exists only for historical events and should be
 * removed after ecosystem migration to the current MIP-03 format.
 */
export declare function decryptLegacyGroupMessageEventContent(content: string, clientState: ClientState, ciphersuite: CiphersuiteImpl): Promise<MlsMessage>;
/**
 * Legacy content encoder kept for test coverage and migration tooling only.
 */
export declare function createLegacyEncryptedGroupEventContent(options: {
    state: ClientState;
    ciphersuite: CiphersuiteImpl;
    serializedMessage: Uint8Array;
}): Promise<string>;
