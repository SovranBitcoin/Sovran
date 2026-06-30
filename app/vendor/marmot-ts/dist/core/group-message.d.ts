import { Rumor } from "applesauce-common/helpers/gift-wrap";
import { NostrEvent } from "applesauce-core/helpers/event";
import { wireformats } from "ts-mls";
import { ClientState } from "ts-mls/clientState.js";
import { CiphersuiteImpl } from "ts-mls/crypto/ciphersuite.js";
import { type MlsMessage } from "ts-mls/message.js";
/**
 * Reads a {@link NostrEvent} and returns the {@link MlsMessage} it contains.
 * Decrypts group-event encrypted content using the exporter_secret from the group state.
 *
 * @param message - The Nostr event containing the encrypted MLS message
 * @param clientState - The ClientState for the group (to get exporter_secret)
 * @param ciphersuite - The ciphersuite implementation
 * @returns The decoded MlsMessage
 */
export declare function decryptGroupMessageEvent(message: NostrEvent, clientState: ClientState, ciphersuite: CiphersuiteImpl): Promise<MlsMessage>;
/**
 * Encrypts the content of a group event using MIP-03.
 *
 * @param state - The ClientState for the group (to get exporter_secret)
 * @param ciphersuite - The ciphersuite implementation
 * @param message - The MLS message to encrypt
 * @returns The encrypted content
 */
export declare function createEncryptedGroupEventContent({ state, ciphersuite, message, }: {
    state: ClientState;
    ciphersuite: CiphersuiteImpl;
    message: MlsMessage;
}): Promise<string>;
export type GroupMessagePair = {
    event: NostrEvent;
    message: MlsMessage;
};
/**
 * Decrypts a kind 445 event and returns the {@link MlsMessage} it contains.
 *
 * @param event - The Nostr event containing the encrypted MLS message
 * @param clientState - The ClientState for the group (to get exporter_secret)
 * @param ciphersuite - The ciphersuite implementation
 * @returns The event and the decoded MlsMessage
 */
export declare function decryptGroupMessage(event: NostrEvent, clientState: ClientState, ciphersuite: CiphersuiteImpl): Promise<GroupMessagePair>;
/**
 * Decrypts multiple kind 445 events and returns the {@link MlsMessage} they contain.
 *
 * @param events - The Nostr events containing the encrypted MLS messages
 * @param clientState - The ClientState for the group (to get exporter_secret)
 * @param ciphersuite - The ciphersuite implementation
 * @returns An array of event and decoded MlsMessage pairs
 */
export declare function decryptGroupMessages(events: NostrEvent[], clientState: ClientState, ciphersuite: CiphersuiteImpl): Promise<{
    read: GroupMessagePair[];
    unreadable: NostrEvent[];
}>;
export type CreateGroupEventOptions = {
    /** The serialized MLS message */
    message: MlsMessage;
    /** The ClientState for the group */
    state: ClientState;
    /** The ciphersuite implementation */
    ciphersuite: CiphersuiteImpl;
};
/**
 * Creates a Nostr event containing an encrypted MLS message.
 *
 * @param options - The options for creating the event
 * @returns A signed Nostr event
 */
export declare function createGroupEvent(options: CreateGroupEventOptions): Promise<NostrEvent>;
/**
 * Serializes an application rumor (unsigned Nostr event) to bytes.
 * This is the format used for application messages in Marmot groups.
 *
 * @param rumor - The unsigned Nostr event to serialize
 * @returns The serialized application data as bytes
 */
export declare function serializeApplicationRumor(rumor: Rumor): Uint8Array;
/**
 * Deserializes application data bytes back into a rumor.
 *
 * @param data - The serialized application data
 * @returns The deserialized Rumor
 */
export declare function deserializeApplicationData(data: Uint8Array): Rumor;
/** @deprecated Kept for internal compatibility. Prefer `deserializeApplicationData`. */
export declare const deserializeApplicationRumor: typeof deserializeApplicationData;
/**
 * Sorts group commits to handle race conditions according to MIP-03.
 *
 * Sorting order (MIP-03):
 * 1. First, sort by commit time (created_at) - older commits first
 * 2. If equal, sort by event id (lexicographically) - lower id first
 *
 * @param commits - Array of commit message pairs to sort
 * @returns Sorted array of commits
 */
export declare function sortGroupCommits(commits: GroupMessagePair[]): GroupMessagePair[];
/**
 * Creates a proposal event for a group.
 *
 * @param options - The options for creating the proposal event
 * @returns A signed Nostr event
 */
export declare function createProposalEvent(options: CreateGroupEventOptions): Promise<NostrEvent>;
/**
 * Creates a commit event for a group.
 *
 * @param options - The options for creating the commit event
 * @returns A signed Nostr event
 */
export declare function createCommitEvent(options: CreateGroupEventOptions): Promise<NostrEvent>;
/**
 * Checks if a message is an application message (not a proposal or commit).
 */
export declare function isApplicationMessage(pair: GroupMessagePair): pair is GroupMessagePair & {
    message: MlsMessage & {
        wireformat: typeof wireformats.mls_private_message;
    };
};
/**
 * Checks if a message is a commit message.
 */
export declare function isCommitMessage(pair: GroupMessagePair): pair is GroupMessagePair & {
    message: MlsMessage & {
        wireformat: typeof wireformats.mls_private_message;
    };
};
/**
 * Checks if a message is a proposal message.
 */
export declare function isProposalMessage(pair: GroupMessagePair): pair is GroupMessagePair & {
    message: MlsMessage & {
        wireformat: typeof wireformats.mls_private_message;
    };
};
