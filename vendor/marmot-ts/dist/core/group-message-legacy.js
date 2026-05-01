import { decode } from "ts-mls";
import { mlsExporter } from "ts-mls/keySchedule.js";
import { mlsMessageDecoder } from "ts-mls/message.js";
import { decryptBytes, encryptBytes, getConversationKey, } from "../utils/nip44-binary.js";
import { getPublicKey } from "applesauce-core/helpers";
let hasWarnedLegacyGroupMessage = false;
/**
 * Emits a one-time warning when legacy MIP-03 group-message decryption is used.
 */
export function warnLegacyGroupMessageUsed() {
    if (hasWarnedLegacyGroupMessage)
        return;
    hasWarnedLegacyGroupMessage = true;
    console.warn("[marmot-ts] Decoded legacy MIP-03 group message format (NIP-44 envelope). This compatibility path is deprecated and will be removed in a future release.");
}
/**
 * Legacy key derivation for pre-spec-update kind-445 payloads.
 *
 * Old format used MLS-Exporter("nostr", "nostr", 32) and then derived a
 * self-addressed NIP-44 conversation key from that secret.
 */
async function getLegacyGroupConversationKey(clientState, ciphersuite) {
    const nostrSecret = await mlsExporter(clientState.keySchedule.exporterSecret, "nostr", new TextEncoder().encode("nostr"), 32, ciphersuite);
    const publicKey = getPublicKey(nostrSecret);
    return getConversationKey(nostrSecret, publicKey);
}
/**
 * Decrypts the legacy kind-445 content envelope and decodes an MLSMessage.
 *
 * This compatibility path exists only for historical events and should be
 * removed after ecosystem migration to the current MIP-03 format.
 */
export async function decryptLegacyGroupMessageEventContent(content, clientState, ciphersuite) {
    const conversationKey = await getLegacyGroupConversationKey(clientState, ciphersuite);
    const serializedMessage = decryptBytes(content, conversationKey);
    const decoded = decode(mlsMessageDecoder, serializedMessage);
    if (!decoded)
        throw new Error("Failed to decode legacy MLS message");
    warnLegacyGroupMessageUsed();
    return decoded;
}
/**
 * Legacy content encoder kept for test coverage and migration tooling only.
 */
export async function createLegacyEncryptedGroupEventContent(options) {
    const conversationKey = await getLegacyGroupConversationKey(options.state, options.ciphersuite);
    return encryptBytes(options.serializedMessage, conversationKey);
}
//# sourceMappingURL=group-message-legacy.js.map