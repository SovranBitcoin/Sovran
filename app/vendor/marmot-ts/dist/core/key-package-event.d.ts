import { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { KeyPackage } from "ts-mls";
import { CiphersuiteId } from "ts-mls/crypto/ciphersuite.js";
import { KeyPackageClient, MLS_VERSIONS } from "./protocol.js";
export type DeleteKeyPackageEventInput = string | NostrEvent;
export type CreateDeleteKeyPackageEventOptions = {
    /** List of event ids (or full events) to delete */
    events: DeleteKeyPackageEventInput[];
};
/**
 * Creates a NIP-09 delete event (kind 5) to delete one or more key package events (kind 443).
 */
export declare function createDeleteKeyPackageEvent(options: CreateDeleteKeyPackageEventOptions): EventTemplate;
/** Get the KeyPackage from a kind 443 event */
export declare function getKeyPackage(event: NostrEvent): KeyPackage;
/** Gets the MLS protocol version from a kind 443 event */
export declare function getKeyPackageMLSVersion(event: NostrEvent): MLS_VERSIONS | undefined;
/** Gets the MLS cipher suite from a kind 443 event */
export declare function getKeyPackageCipherSuiteId(event: NostrEvent): CiphersuiteId | undefined;
/** Gets the MLS extensions for a kind 443 event */
export declare function getKeyPackageExtensions(event: NostrEvent): number[] | undefined;
/** Gets the relays for a kind 443 event */
export declare function getKeyPackageRelays(event: NostrEvent): string[] | undefined;
/** Gets the client for a kind 443 event */
export declare function getKeyPackageClient(event: NostrEvent): KeyPackageClient | undefined;
export type CreateKeyPackageEventOptions = {
    keyPackage: KeyPackage;
    /** Pubkey of the author (optional for drafts; required for Nostr kind 443 events) */
    relays?: string[];
    client?: string;
    /**
     * Whether to include the NIP-70 protected tag (["-"]).
     *
     * Per MIP-00 this SHOULD be omitted by default because many relays reject
     * protected events.
     */
    protected?: boolean;
};
/**
 * Creates a key package event (kind 443) from a key package.
 *
 * @param options - The options for creating the key package event
 * @returns The unsigned key package event
 */
export declare function createKeyPackageEvent(options: CreateKeyPackageEventOptions): Promise<EventTemplate>;
/**
 * Gets the nostr public key from a key package event.
 *
 * @param event - The key package event
 * @returns The nostr public key (hex string)
 * @throws Error if the credential is not a basic credential
 */
export declare function getKeyPackageNostrPubkey(event: NostrEvent): string;
/**
 * Returns the KeyPackageRef (MIP-00 `i` tag value) from a kind 443 KeyPackage event.
 *
 * Per MIP-00, new events MUST include this tag. Older events may not.
 */
export declare function getKeyPackageReference(event: NostrEvent): string | undefined;
