import { Rumor } from "applesauce-common/helpers/gift-wrap";
import { NostrEvent } from "applesauce-core/helpers/event";
import { type GroupInfo } from "ts-mls";
import { CiphersuiteImpl } from "ts-mls/crypto/ciphersuite.js";
import { KeyPackage, PrivateKeyPackage } from "ts-mls/keyPackage.js";
import { type Welcome } from "ts-mls/welcome.js";
import { type MarmotGroupData } from "./protocol.js";
/**
 * Creates a welcome rumor (kind 444) for a welcome message.
 *
 * @param welcomeMessage - The MLS welcome message
 * @param keyPackageEventId - The ID of the key package event used for the add operation
 * @param author - The author's public key (hex string)
 * @param groupRelays - Array of relay URLs for the group
 * @returns Welcome rumor with precomputed ID
 */
export declare function createWelcomeRumor({ welcome, author, groupRelays, keyPackageEventId, }: {
    welcome: Welcome;
    author: string;
    keyPackageEventId?: string;
    keyPackageEvent?: NostrEvent;
    groupRelays: string[];
}): Rumor;
/** Returns the key package event ID from a welcome rumor */
export declare function getWelcomeKeyPackageEventId(event: Rumor): string | undefined;
/** Returns the group relays from a welcome rumor */
export declare function getWelcomeGroupRelays(event: Rumor): string[];
/**
 * Returns the KeyPackageRefs of the intended recipients from a Welcome message.
 *
 * Each entry in `welcome.secrets` contains a plaintext `newMember` field which
 * is the RFC 9420 KeyPackageRef (a hash of the recipient's KeyPackage). No
 * decryption is required to read these.
 *
 * @param welcome - The MLS Welcome message
 * @returns Array of KeyPackageRefs (one per recipient)
 */
export declare function getWelcomeKeyPackageRefs(welcome: Welcome | Rumor): Uint8Array[];
/**
 * Gets the Welcome message from a kind 444 event.
 *
 * @param event - The Nostr event containing the welcome message
 * @returns The decoded Welcome message
 * @throws Error if the content cannot be decoded
 */
export declare function getWelcome(event: Rumor): Welcome;
/**
 * Decrypts the {@link GroupInfo} from a Welcome message using the provided key package,
 * without performing a full group join.
 *
 * This is lighter than `joinGroup` — it stops after decrypting the group secrets
 * and group info, giving access to `groupContext` (group ID, epoch, extensions) and
 * `GroupInfo`-level extensions (ratchet tree, external pub).
 *
 * @param welcome - The MLS Welcome message (or a kind 444 Rumor)
 * @param keyPackage - The full key package (public + private) used to receive the invite
 * @param ciphersuiteImpl - The ciphersuite implementation
 * @returns The decrypted GroupInfo
 * @throws Error if the key package does not match any secret in the welcome
 */
export declare function readWelcomeGroupInfo({ welcome, keyPackage, ciphersuiteImpl, }: {
    welcome: Welcome | Rumor;
    keyPackage: {
        publicPackage: KeyPackage;
        privatePackage: PrivateKeyPackage;
    };
    ciphersuiteImpl: CiphersuiteImpl;
}): Promise<GroupInfo>;
/**
 * Reads the {@link MarmotGroupData} from a Welcome message using the provided key package,
 * without performing a full group join.
 *
 * Convenience wrapper around {@link readWelcomeGroupInfo} that extracts and decodes
 * the Marmot Group Data extension from `groupInfo.groupContext.extensions`.
 *
 * @param welcome - The MLS Welcome message (or a kind 444 Rumor)
 * @param keyPackage - The full key package (public + private) used to receive the invite
 * @param ciphersuiteImpl - The ciphersuite implementation
 * @returns The decoded MarmotGroupData, or null if the extension is not present
 */
export declare function readWelcomeMarmotGroupData({ welcome, keyPackage, ciphersuiteImpl, }: {
    welcome: Welcome | Rumor;
    keyPackage: {
        publicPackage: KeyPackage;
        privatePackage: PrivateKeyPackage;
    };
    ciphersuiteImpl: CiphersuiteImpl;
}): Promise<MarmotGroupData | null>;
